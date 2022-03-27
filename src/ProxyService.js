const fs = require('fs')
const net = require('net')
const tls = require('tls')
const path = require('path')

class ProxyService {
    static get DEFAULT_BALANCE () { return 'roundrobin' }
    static get DEFAULT_TIMEOUT_SECONDS () { return 75 }

    static get ALLOWED_BALANCE_METHODS () {
        return [
            'roundrobin',
            'leastconn'
        ]
    }

    VERBOSE = true

    name = null
    host = null
    port = null
    sslEnabled = false
    balanceMethod = null
    numClientConnections = 0
    lastConnected = -1
    // backends = {}
    config = {}
    server = null
    engine = net
    backendConnectionData = {}
    sslKeyData = null
    sslCertificateData = null
    timeoutSeconds = 75
    accessLogPath = null
    errorLogPath = null
    serviceConfigPath = null

    constructor (serverName, serviceConfigPath, serviceConfig) {
        this.VERBOSE = true
        this.serviceConfigPath = serviceConfigPath
        this.name = serverName
        const { accessLogPath, errorLogPath } = this.resolveLogs(
            serviceConfigPath,
            serviceConfig.access_log,
            serviceConfig.error_log
        )
        this.accessLogPath = accessLogPath
        this.errorLogPath = errorLogPath
        console.log(this.accessLogPath)
        const { host, port, sslEnabled } = this.getHostAndPort(serviceConfig.listen)
        this.host = host
        this.port = port
        this.sslEnabled = sslEnabled
        this.balanceMethod = this.getBalanceMethod(serviceConfig.balance)
        this.numClientConnections = null
        this.backends = {}
        this.config = serviceConfig
        if (this.sslEnabled) {
            this.engine = tls
            const { sslKeyData, sslCertificateData } = this.readSslCertificates(
                serviceConfigPath,
                serviceConfig.ssl_certificate_key,
                serviceConfig.ssl_certificate
            )
            this.sslKeyData = sslKeyData
            this.sslCertificateData = sslCertificateData
        } else {
            this.engine = net
        }

        let backends = this.getBackends(serviceConfig.backends)
        console.log(typeof(backends))
        // if there's only one backend, let's put it into an array
        if (typeof(backends) === 'string') {
            backends = [backends]
        }
        this.backendConnectionData = {}
        backends.map(backend => {
            this.backendConnectionData[backend] = {
                numClientConnections: 0
            }
        })
        if (serviceConfig.keepalive_timeout) {
            this.timeoutSeconds = this.getTimeoutSeconds(serviceConfig.keepalive_timeout)
        }
        this.lastConnected = -1
        this.createServer()
    }

    listen () {
        this.server.listen(this.port, this.host, () => {
            this.log(`[${this.formatDate(new Date())}] Starting reverse proxy "${this.name}" on ${this.host}:${this.port} using ${this.balanceMethod}, ssl: ${String(this.sslEnabled)}`)
        })
    }

    createServer () {
        let server = null
        if (this.sslEnabled) {
            const sslOptions = {
                key: this.sslKeyData,
                cert: this.sslCertificateData,
                // requestCert: true, // only use this for client certificate auth
            }
            server = this.engine.createServer(sslOptions, socket => {
                this.configureServer(socket)
            })
        } else {
            server = this.engine.createServer(socket => {
                this.configureServer(socket)
            })
        }
        this.server = server
    }

    configureServer (socket) {
        const connectedBackendName = this.logClientConnect()
        const { host, port } = this.getHostAndPort(connectedBackendName)
        // connect to backend and handle data
        socket.setTimeout(this.timeoutSeconds)
        const client = new net.Socket()
        client.connect(port, host)
        client.on('data', data => {
            socket.write(data)
        })
        const clientAddress = socket.address().address
        this.log(`[${this.formatDate(new Date())}] Client ${clientAddress} connected to service ${this.name}, routing to ${connectedBackendName}`)
        socket.on('end', () => {
            client.end()
            this.log(`[${this.formatDate(new Date())}] Client ${clientAddress} disconnected from service ${this.name}, on backend ${connectedBackendName}`)
            this.logClientDisconnect(connectedBackendName)
        })
        socket.on('data', data => {
            client.write(data)
        })
        socket.on('timeout', () => {
            this.log(`[${this.formatDate(new Date())}] Client ${clientAddress} timeout from service ${this.name}, on backend ${connectedBackendName}`);
            socket.destroy()
        })
    }

    readSslCertificates (configPath, sslCertificateKeyPath, sslCertificatePath) {
        let sslKeyData = null
        let sslCertificateData = null
        if (sslCertificateKeyPath) {
            let fullSslKeyPath = ''
            if (path.isAbsolute(sslCertificateKeyPath)) {
                fullSslKeyPath = sslCertificateKeyPath
            } else {
                fullSslKeyPath = path.resolve(path.join(configPath, sslCertificateKeyPath))
            }
            sslKeyData = fs.readFileSync(fullSslKeyPath, 'utf8')
        } else {
            throw Error(`Invalid ssl_certificate_key for ${this.name}: "${sslCertificateKeyPath}"`)
        }
        if (sslCertificatePath) {
            let fullSslCertificatePath = ''
            if (path.isAbsolute(sslCertificatePath)) {
                fullSslCertificatePath = sslCertificatePath
            } else {
                fullSslCertificatePath = path.resolve(path.join(configPath, sslCertificatePath))
            }
            sslCertificateData = fs.readFileSync(fullSslCertificatePath, 'utf8')
        } else {
            throw Error(`Invalid ssl_certificate for ${this.name}: "${sslCertificatePath}"`)
        }
        return { sslKeyData, sslCertificateData }
    }

    getTimeoutSeconds (keepaliveTimeout) {
        let timeoutSeconds = ProxyService.DEFAULT_TIMEOUT_SECONDS
        const splitPos = keepaliveTimeout.indexOf(' ')
        let rawInfo = keepaliveTimeout
        if (splitPos > 0) {
            rawInfo = rawInfo.substring(0, splitPos)
        }
        timeoutSeconds = parseInt(rawInfo)
        if (isNaN(timeoutSeconds)) {
            throw Error(`Invalid keepalive_timeout for service ${this.name}`)
        }
        return timeoutSeconds
    }

    logClientConnect (service) {
        const { backendName, nextConnectedBackend } = this.getNextConnectionBackend()
        this.numClientConnections += 1
        this.lastConnectedBackend = nextConnectedBackend
        this.backendConnectionData[backendName].numClientConnections += 1
        return backendName
    }

    logClientDisconnect (backendName) {
        this.numClientConnections -= 1
        // this.lastConnectedBackend = nextConnectedBackend
        this.backendConnectionData[backendName].numClientConnections -= 1
    }

    getBackends (backends) {
        return backends.server
    }

    getHostAndPort (hostPort) {
        // expect `host:port;` or `host:port ssl;`
        let sslEnabled = false
        let host = '0.0.0.0'
        let portString = ''
        let remainingHostPort = hostPort
        const sslSplitPos = hostPort.indexOf(' ')
        if (sslSplitPos > 0) {
            const sslString = hostPort.substr(sslSplitPos + 1)
            if (sslString != 'ssl') {
                throw Error(`Unknown flag ${sslString} in 'listen' definition of server ${this.name}`)
            }
            sslEnabled = true
            remainingHostPort = hostPort.substring(0, sslSplitPos)
        }
        const splitPos = remainingHostPort.lastIndexOf(':')
        if (splitPos == 0) {
            portString = remainingHostPort.substr(splitPos + 1)
        } else if (splitPos > 0) {
            host = remainingHostPort.substring(0, splitPos)
            portString = remainingHostPort.substr(splitPos + 1)
        }
        const port = parseInt(portString)
        if (isNaN(port) || port < 1 || port > 65535) {
            throw Error(`Invalid port: ${portString}`)
        }
        return { host, port, sslEnabled }
    }

    getBalanceMethod (balanceMethod) {
        if (balanceMethod) {
            if (!ProxyService.ALLOWED_BALANCE_METHODS.includes(balanceMethod)) {
                throw Error(`Invalid balance method: ${balanceMethod} in ${this.name}. Expected one of ${ProxyService.ALLOWED_BALANCE_METHODS.join(', ')}`)
            }
            return balanceMethod
        } else {
            return ProxyService.DEFAULT_BALANCE
        }
    }

    getNextConnectionBackend () {
        // TODO: create a failover policy
        const backendNames = Object.keys(this.backendConnectionData)
        switch (this.balanceMethod) {
            case 'leastconn':
                // loop through connections and find least connected one
                let leastConnections = Infinity
                let connectionRow = 0
                let connectionBackend = null
                for (let row = 0; row <= backendNames.length; row++) {
                    const backendName = backendNames[row]
                    const backendData = this.backendConnectionData[backendName]
                    if (backendData.numClientConnections < leastConnections) {
                        leastConnections = backendData.numClientConnections
                        connectionBackend = backendName
                        connectionRow = row
                    }
                    if (backendData.numClientConnections == 0) {
                        break
                    }
                }
                return {
                    backendName: connectionBackend,
                    row: connectionRow
                }
                return retval
            break
            case 'roundrobin':
            default:
                const lastConnected = this.lastConnected
                let nextConnected = 0
                if (lastConnected < 0) {
                    nextConnected = 0
                }
                if (nextConnected > backendNames.length) {
                    nextConnected = 0
                }
                return { 
                    backendName: backendNames[nextConnected],
                    row: nextConnected
                }
        }
    }

    resolveLogs (configPath, relativeAccessLogPath, relativeErrorLogPath) {
        let accessLogPath = null
        let errorLogPath = null
        if (relativeAccessLogPath) {
            if (path.isAbsolute(relativeAccessLogPath)) {
                accessLogPath = relativeAccessLogPath
            } else {
                accessLogPath = path.resolve(path.join(configPath, relativeAccessLogPath))
            }
            try {
                fs.appendFileSync(accessLogPath, '')
            } catch (error) {
                throw Error(`Error: could not open access_log file: ${accessLogPath}`)
            }
        }
        if (relativeErrorLogPath) {
            if (path.isAbsolute(relativeErrorLogPath)) {
                errorLogPath = relativeErrorLogPath
            } else {
                errorLogPath = path.resolve(path.join(configPath, relativeErrorLogPath))
            }
            try {
                fs.appendFileSync(errorLogPath, '')
            } catch (error) {
                throw Error(`Error: could not open error_log file: ${errorLogPath}`)
            }
        }
        return { accessLogPath, errorLogPath }
    }

    formatDate (d) {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        const hour = String(d.getHours()).padStart(2, '0')
        const minute = String(d.getMinutes()).padStart(2, '0')
        const second = String(d.getSeconds()).padStart(2, '0')
        return `${year}-${month}-${day} ${hour}:${minute}:${second}`
    }

    log (message) {
        let output = ''
        if (typeof(message) == 'string') {
            output = message
        } else {
            output = JSON.stringify(message)
        }
        if (this.VERBOSE) {
            console.log(output)
        }
        // append to the log
        if (this.accessLogPath) {
            fs.appendFileSync(this.accessLogPath, message + "\n")
        }
    }

    error (message) {
        let output = ''
        if (typeof(message) == 'string') {
            output = message
        } else {
            output = JSON.stringify(message)
        }
        if (this.VERBOSE) {
            console.error(output)
        }
        // append to the error log
        if (this.errorLogPath) {
            fs.appendFileSync(this.errorLogPath, message + "\n")
        }
    }
}

exports.ProxyService = ProxyService
