const net = require('net')
const path = require('path')
const ConfigParser = require('@webantic/nginx-config-parser')
const { ProxyService } = require('./ProxyService')
const defaultServiceName = 'nobody'

const humanError = (message) => {
    console.error(message)
    process.exit(1)
}

let defaultConfigPath = process.env.DEFAULT_CONFIG_PATH
if (!defaultConfigPath) {
    defaultConfigPath = '/etc/jsreverseproxy/jsreverseproxy.conf'
}

let configFilePath = defaultConfigPath
if (process.argv.length > 2) {
    configFilePath = process.argv[2]
}

const parser = new ConfigParser()
let config = {
    path: path.dirname(path.resolve(configFilePath)),
    data: null
}
try {
    config.data = parser.readConfigFile(configFilePath)
} catch (error) {
    humanError(`Error: config file couldn't be found: "${configFilePath}`)
}

// active services
const services = {}
const inboundPorts = []


// how does this work:
// you connect to it on a port, and it attempts to redirect
// redirects are managed based on some mapping rules
// for example, the reverse proxy might be a round robin or random or least number of connections

const startServers = (config) => {
    const configPath = config.path
    let services = config.data.server.service
    // if there's only one service, put it in an array
    if (services.length ===  undefined) {
        services = [services]
    }
    if (services && services.length) {
        services.forEach(serviceConfig => {
            let serverName = defaultServiceName
            if (serviceConfig.server_name) {
                serverName = serviceConfig.server_name
            }
            if (serverName in services) {
                throw Error(`Multiple servers with the same name: ${sserverName}`)
            }
            const proxyService = new ProxyService(serverName, configPath, serviceConfig)
            proxyService.listen()
            services[serverName] = proxyService
        })
    } else {
        console.error('`service` block must be defined in config')
    }
}

try {
    startServers(config)
} catch (error) {
    humanError(`Error: ${error.toString()}`)
}
