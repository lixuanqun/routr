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
import {
  HeaderModifier,
  MessageRequest,
  Transport,
  CommonConnect as CC,
  CommonTypes as CT
} from "@routr/common"
import { RoutingDirection } from "./types"

// OMG, this is so ugly and hacky
export const isKind = (res: CC.RoutableResourceUnion, kind: CC.Kind) => {
  if (res == null && kind === CC.Kind.UNKNOWN) {
    return true
  } else if (res == null) {
    return false
  } else if ("privacy" in res && kind === CC.Kind.AGENT) {
    return true
  } else if ("telUrl" in res && kind === CC.Kind.NUMBER) {
    return true
  } else if ("username" in res && kind === CC.Kind.PEER) {
    return true
  }
}

export const findDomain = async (
  apiClient: CC.APIClient,
  domainUri: string
) => {
  return (
    await apiClient.domains.findBy<CC.Domain>({
      fieldName: "domainUri",
      fieldValue: domainUri
    })
  ).items[0]
}

export const findNumberByTelUrl = async (
  apiClient: CC.APIClient,
  telUrl: string
) => {
  return (
    await apiClient.numbers.findBy<CC.INumber>({
      fieldName: "telUrl",
      fieldValue: telUrl
    })
  ).items[0]
}

export const findResource = async (
  apiClient: CC.APIClient,
  domainUri: string,
  userpart: string
): Promise<CC.RoutableResourceUnion> => {
  const domain = await findDomain(apiClient, domainUri)

  // First, try to find a number
  const number = await findNumberByTelUrl(apiClient, `tel:${userpart}`)

  if (number != null) return number

  // Next, try to find an agent
  const agent = (
    await apiClient.agents.findBy<CC.Agent>({
      fieldName: "username",
      fieldValue: userpart
    })
  ).items[0]

  if (agent && agent.domain.ref != domain?.ref) {
    // Not in the same domain
    return null
  }

  if (agent != null) return agent

  // Next, try to find a peer
  return (
    await apiClient.peers.findBy<CC.Peer>({
      fieldName: "username",
      fieldValue: userpart
    })
  ).items[0]
}

export const getRoutingDirection = (
  caller: CC.RoutableResourceUnion,
  callee: CC.RoutableResourceUnion
) => {
  if (isKind(caller, CC.Kind.AGENT) && isKind(callee, CC.Kind.AGENT)) {
    return RoutingDirection.AGENT_TO_AGENT
  }

  if (isKind(caller, CC.Kind.AGENT) && isKind(callee, CC.Kind.UNKNOWN)) {
    return RoutingDirection.AGENT_TO_PSTN
  }

  if (isKind(caller, CC.Kind.PEER) && isKind(callee, CC.Kind.AGENT)) {
    return RoutingDirection.PEER_TO_AGENT
  }

  // All we know is that the Number is managed by this instance of Routr
  if (isKind(callee, CC.Kind.NUMBER)) {
    return RoutingDirection.FROM_PSTN
  }

  if (isKind(caller, CC.Kind.PEER) && isKind(callee, CC.Kind.UNKNOWN)) {
    return RoutingDirection.PEER_TO_PSTN
  }

  return RoutingDirection.UNKNOWN
}

export const createPAssertedIdentity = (
  req: MessageRequest,
  trunk: CC.Trunk,
  number: CC.INumber
): HeaderModifier => {
  const displayName = req.message.from.address.displayName
  const remoteNumber = number.telUrl.split(":")[1]
  const trunkHost = getTrunkURI(trunk).host
  return {
    name: "P-Asserted-Identity",
    value: displayName
      ? `"${displayName}" <sip:${remoteNumber}@${trunkHost};user=phone>`
      : `<sip:${remoteNumber}@${trunkHost};user=phone>`,
    action: CT.HeaderModifierAction.ADD
  }
}

export const createRemotePartyId = (
  trunk: CC.Trunk,
  number: CC.INumber
): HeaderModifier => {
  const remoteNumber = number.telUrl.split(":")[1]
  const trunkHost = getTrunkURI(trunk).host
  return {
    name: "Remote-Party-ID",
    value: `<sip:${remoteNumber}@${trunkHost}>;screen=yes;party=calling`,
    action: CT.HeaderModifierAction.ADD
  }
}

export const createTrunkAuthentication = async (
  trunk: CC.Trunk
): Promise<HeaderModifier> => {
  return {
    name: CT.ExtraHeader.GATEWAY_AUTH,
    value: Buffer.from(
      `${trunk.outboundCredentials?.username}:${trunk.outboundCredentials?.password}`
    ).toString("base64"),
    action: CT.HeaderModifierAction.ADD
  }
}

export const getTrunkURI = (
  trunk: CC.Trunk
): {
  host: string
  port: number
  user: string
  transport: Transport
} => {
  if (!trunk.uris) {
    throw new Error(`trunk ${trunk.ref} has no outbound settings`)
  }

  const { user, host, port, transport } = trunk.uris[0]

  return {
    user,
    host,
    port: port ?? 5060,
    transport: transport ?? Transport.UDP
  }
}

export const getSIPURI = (uri: { user?: string; host: string }) =>
  uri.user ? `sip:${uri.user}@${uri.host}` : `sip:${uri.host}`
