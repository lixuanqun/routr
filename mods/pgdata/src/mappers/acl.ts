/*
 * Copyright (C) 2024 by Fonoster Inc (https://fonoster.com)
 * http://github.com/fonoster/routr
 *
 * This file is part of Routr.
 *
 * Licensed under the MIT License (the "License");
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
/* eslint-disable require-jsdoc */
import { AccessControlList as ACLPrismaModel, APIVersion } from "@prisma/client"
import { CommonConnect as CC } from "@routr/common"
import { EntityManager } from "./manager"
import { JsonValue } from "@prisma/client/runtime/library"

export class ACLManager extends EntityManager {
  constructor(private acl: CC.AccessControlList) {
    super()
  }

  static includeFields(): Record<string, unknown> {
    return null
  }

  validOrThrowCreate() {
    CC.hasNameOrThrow(this.acl.name)
    CC.isValidNameOrThrow(this.acl.name)
    CC.hasACLRulesOrThrow(this.acl)
    CC.hasValidACLRulesOrThrow(this.acl)
  }

  validOrThrowUpdate() {
    CC.hasReferenceOrThrow(this.acl.ref)
    CC.isValidNameOrThrow(this.acl.name)
    CC.hasValidACLRulesOrThrow(this.acl)
  }

  mapToPrisma(): ACLPrismaModel {
    return {
      // TODO: Create a default value for apiVersion
      ...this.acl,
      apiVersion: "v2" as APIVersion,
      createdAt: undefined,
      updatedAt: undefined,
      extended: this.acl.extended as JsonValue
    }
  }

  static mapToDto(acl: ACLPrismaModel): CC.AccessControlList {
    return acl
      ? {
          ...acl,
          apiVersion: acl.apiVersion as CC.APIVersion,
          createdAt: acl.createdAt.getTime() / 1000,
          updatedAt: acl.updatedAt.getTime() / 1000,
          extended: acl.extended as Record<string, unknown>
        }
      : undefined
  }
}
