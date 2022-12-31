/*
 * Copyright (C) 2022 by Fonoster Inc (https://fonoster.com)
 * http://github.com/fonoster/routr
 *
 * This file is part of Routr
 *
 * Licensed under the MIT License (the "License")
 * you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 *    https://opensource.org/licenses/MIT
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { RoutingDirection } from "./types"
import {
  CommonConnect as CC,
  CommonTypes as CT,
  HeaderModifier,
  Route
} from "@routr/common"
import {
  createPAssertedIdentity,
  createRemotePartyId,
  createTrunkAuthentication,
  findNumberByTelUrl,
  findResource,
  getRoutingDirection,
  getSIPURI,
  getTrunkURI
} from "./utils"
import { MessageRequest, Target as T, Extensions as E } from "@routr/processor"
import { NotRoutesFoundForAOR, ILocationService } from "@routr/location"
import { UnsuportedRoutingError } from "./errors"
import { getLogger } from "@fonoster/logger"
import { checkAccess } from "./access"

const logger = getLogger({ service: "connect", filePath: __filename })

// eslint-disable-next-line require-jsdoc
export function router(location: ILocationService, apiClient: CC.APIClient) {
  return async (
    request: MessageRequest
  ): Promise<Route | Record<string, unknown>> => {
    const fromURI = request.message.from.address.uri
    const requestURI = request.message.requestUri

    const caller = await findResource(apiClient, fromURI.host, fromURI.user)
    const callee = await findResource(
      apiClient,
      requestURI.host,
      requestURI.user
    )

    const routingDirection = getRoutingDirection(caller, callee)

    logger.verbose(
      "routing request from: " +
        getSIPURI(fromURI) +
        ", to: " +
        getSIPURI(requestURI),
      {
        fromURI: getSIPURI(fromURI),
        requestURI: getSIPURI(requestURI),
        routingDirection
        // sessionAffinityHeader: callee?.spec.location?.sessionAffinityHeader
      }
    )

    if (request.method === CT.Method.INVITE) {
      const failedCheck = await checkAccess({
        apiClient,
        request,
        caller,
        callee,
        routingDirection
      })

      if (failedCheck) {
        return failedCheck
      }
    }

    switch (routingDirection) {
      case RoutingDirection.AGENT_TO_AGENT:
        return agentToAgent(location, request)
      case RoutingDirection.AGENT_TO_PSTN:
        return await agentToPSTN(request, caller as CC.Agent, requestURI.user)
      case RoutingDirection.FROM_PSTN:
        return await fromPSTN(location, callee as CC.INumber, request)
      case RoutingDirection.PEER_TO_PSTN:
        return await peerToPSTN(apiClient, request)
      default:
        throw new UnsuportedRoutingError(routingDirection)
    }
  }
}

// eslint-disable-next-line require-jsdoc
async function agentToAgent(
  location: ILocationService,
  req: MessageRequest
): Promise<Route> {
  return (
    await location.findRoutes({ aor: T.getTargetAOR(req), callId: req.ref })
  )[0]
}

/**
 * From PSTN routing.
 *
 * @param {ILocationService} location - Location service
 * @param {Resource} callee - The callee
 * @param {MessageRequest} req - The request
 * @return {Promise<Route>}
 */
async function fromPSTN(
  location: ILocationService,
  callee: CC.INumber,
  req: MessageRequest
): Promise<Route> {
  const sessionAffinityRef = E.getHeaderValue(req, callee.sessionAffinityHeader)

  const route = (
    await location.findRoutes({
      aor: callee.aorLink,
      callId: req.ref,
      sessionAffinityRef
    })
  )[0]

  if (!route) {
    throw new NotRoutesFoundForAOR(callee.aorLink)
  }

  if (!route.headers) route.headers = []

  callee.extraHeaders?.forEach((prop: { name: string; value: string }) => {
    const p: HeaderModifier = {
      name: prop.name,
      value: prop.value,
      action: CT.HeaderModifierAction.ADD
    }
    route.headers.push(p)
  })

  return route
}

// eslint-disable-next-line require-jsdoc
async function agentToPSTN(
  req: MessageRequest,
  agent: CC.Agent,
  calleeNumber: string
): Promise<Route> {
  if (!agent.domain?.egressPolicies) {
    // TODO: Create custom error
    throw new Error(
      `no egress policy found for Domain ref: ${agent.domain.ref}`
    )
  }

  // Look for Number in domain that matches regex callee
  const policy = agent.domain.egressPolicies.find(
    (policy: { rule: string }) => {
      const regex = new RegExp(policy.rule)
      return regex.test(calleeNumber)
    }
  )

  const trunk = policy.number?.trunk

  if (!trunk) {
    // This should never happen
    throw new Error(
      `no trunk associated with Number ref: ${policy.number?.ref}`
    )
  }

  const uri = getTrunkURI(trunk)

  return {
    user: uri.user,
    host: uri.host,
    port: uri.port,
    transport: uri.transport,
    edgePortRef: req.edgePortRef,
    listeningPoints: req.listeningPoints,
    localnets: req.localnets,
    externalAddrs: req.externalAddrs,
    headers: [
      // TODO: Find a more deterministic way to re-add the Privacy header
      {
        name: "Privacy",
        action: CT.HeaderModifierAction.REMOVE
      },
      {
        name: "Privacy",
        value:
          agent.privacy?.toLowerCase() === CT.Privacy.PRIVATE
            ? CT.Privacy.PRIVATE
            : CT.Privacy.NONE,
        action: CT.HeaderModifierAction.ADD
      },
      createRemotePartyId(trunk, policy.number),
      createPAssertedIdentity(req, trunk, policy.number),
      await createTrunkAuthentication(trunk)
    ]
  }
}

// eslint-disable-next-line require-jsdoc
async function peerToPSTN(
  apiClient: CC.APIClient,
  req: MessageRequest
): Promise<Route> {
  const numberTel = E.getHeaderValue(req, CT.ExtraHeader.DOD_NUMBER)
  const privacy = E.getHeaderValue(req, CT.ExtraHeader.DOD_PRIVACY)
  const number = await findNumberByTelUrl(apiClient, `tel:${numberTel}`)

  if (!number) {
    throw new Error(`no Number found for tel: ${numberTel}`)
  }

  if (!number.trunk) {
    // TODO: Create custom error
    throw new Error(`no trunk associated with Number ref: ${number.ref}`)
  }

  const uri = getTrunkURI(number.trunk)

  return {
    user: uri.user,
    host: uri.host,
    port: uri.port,
    transport: uri.transport,
    edgePortRef: req.edgePortRef,
    listeningPoints: req.listeningPoints,
    localnets: req.localnets,
    externalAddrs: req.externalAddrs,
    headers: [
      // TODO: Find a more deterministic way to re-add the Privacy header
      {
        name: "Privacy",
        action: CT.HeaderModifierAction.REMOVE
      },
      {
        name: "Privacy",
        value:
          privacy?.toLocaleLowerCase() === CT.Privacy.PRIVATE
            ? CT.Privacy.PRIVATE
            : CT.Privacy.NONE,
        action: CT.HeaderModifierAction.ADD
      },
      createRemotePartyId(number.trunk, number),
      createPAssertedIdentity(req, number.trunk, number),
      await createTrunkAuthentication(number.trunk)
    ]
  }
}
