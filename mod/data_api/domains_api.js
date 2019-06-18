
/**
 * @author Pedro Sanders
 * @since v1
 */
const CoreUtils = require('@routr/core/utils')
const DSUtils = require('@routr/data_api/utils')
const { Status } = require('@routr/core/status')
const { UNFULFILLED_DEPENDENCY_RESPONSE } = require('@routr/core/status')
const Caffeine = Java.type('com.github.benmanes.caffeine.cache.Caffeine')
const TimeUnit = Java.type('java.util.concurrent.TimeUnit')

const foundDependentObjects = { status: Status.CONFLICT, message: Status.message[4092].value }

class DomainsAPI {

    constructor(dataSource) {
        this.ds = dataSource
        this.cache = Caffeine.newBuilder()
          .expireAfterWrite(5, TimeUnit.MINUTES)
          .maximumSize(5000)
          .build()
    }

    createFromJSON(jsonObj) {
        if(jsonObj.spec.context.egressPolicy
            && !this.doesDIDExist(jsonObj.spec.context.egressPolicy.didRef)) {
              return UNFULFILLED_DEPENDENCY_RESPONSE
        }

        if (!this.domainExist(jsonObj.spec.context.domainUri)) {
            const response = this.ds.insert(jsonObj)
            this.cache.put(jsonObj.spec.context.domainUri, response)
            return response
        }

        return CoreUtils.buildResponse(Status.CONFLICT)
    }

    updateFromJSON(jsonObj) {
        if(jsonObj.spec.context.egressPolicy
            && !this.doesDIDExist(json.spec.context.egressPolicy.didRef)) {
              return UNFULFILLED_DEPENDENCY_RESPONSE
        }

        if (this.domainExist(jsonObj.spec.context.domainUri)) {
            const response = this.ds.update(jsonObj)
            this.cache.put(jsonObj.spec.context.domainUri, response)
            return response
        }

        return CoreUtils.buildResponse(Status.NOT_FOUND)
    }

    getDomains(filter) {
        return this.ds.withCollection('domains').find(filter)
    }

    getDomain(ref) {
        return this.ds.withCollection('domains').get(ref)
    }

    getDomainByUri(domainUri) {
        let response = this.cache.getIfPresent(domainUri)

        if (response === null) {
            response = DSUtils.deepSearch(this.getDomains(), "spec.context.domainUri", domainUri)
            this.cache.put(domainUri, response)
        }
        return response
    }

    domainExist(domainUri) {
        return DSUtils.objExist(this.getDomainByUri(domainUri))
    }

    deleteDomain(ref) {
        if (this.cache.getIfPresent(ref)) {
          this.cache.invalidate(ref)
        }

        let response = this.getDomain(ref)

        if (response.status !== Status.OK) {
            return response
        }

        const domain = response.result

        response = this.ds.withCollection('agents').find("'" + domain.spec.context.domainUri + "' in @.spec.domains")
        const agents = response.result

        return agents.length === 0? this.ds.withCollection('domains').remove(ref) : foundDependentObjects
    }

    doesDIDExist(didRef) {
        const response = this.ds.withCollection('dids').get(didRef)
        return response.status === Status.OK
    }
}

module.exports = DomainsAPI
