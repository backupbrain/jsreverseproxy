
# JS-Reverse-Proxy

This is a reverse proxy. It's designed to function like [HAProxy](https://www.haproxy.org/) but be configured using an [NGiNX](https://www.nginx.com/)-like config file.

It uses an NGiNX-like config to define ports that route to one or more other services.

A reverse proxy helps in scaling server deployments. The purpose is to provide a single IP address that routes client connections to multiple servers. 

An example use case is to have multiple web servers, each of which might become overwhelmed by client requests when serving traffic on their own. They can be bound together under a reverse proxy, which balances the load of client requests across these multiple web servers, thereby allowing a web service to scale to multiple simultaneous web servers and many more client connections.

## Setting up

Check out this project and then set up the environment:

```console
$ cp .env.example .env
```

By default, the `.env` contains the default config file path, `/etc/jsreverseproxy/jsreverseproxy.conf`:

```
DEFAULT_CONFIG_FILE_PATH=/etc/jsreverseproxy/jsreverseproxy.conf
```

## Configure

Create a config file (by default in `/etc/jsreverseproxy/jsreverseproxy.conf`):

```console
$ sudo mkdir /etc/jsreverseproxy
$ cp -R jsreverseproxy.example.conf /etc/jsreverseproxy/jsreverseproxy.conf
```

Then edit the config file to your needs. The example contains all possible parameters.

```console
$ sudo vi /etc/jsreverseproxy/jsreverseproxy.conf
```

## Running

To run, type this command from the project folder. This will load the default config file.

```console
$ ./jsreverseproxy.sh
```

If you want to use a custom config, you can pass it as an argument:


```console
$ ./jsreverseproxy.sh ./config.conf
```

## Configuration

Example config
```
server {
    service {                   # One or more `service` blocks can be defined
        server_name web;        # Default name: 'nobody'
        listen 0.0.0.0:443 ssl; # Listen on a host:port, with optional 'ssl'
        balance roundrobin;     # Rotate through proxy backends
        ssl_certificate ssl-certs/server.crt;   # SSL certificate (required if `listen` has 'ssl')
        ssl_certificate_key ssl-certs/server.key;   # SSL key (required if `listen` has 'ssl')
        keepalive_timeout 10;   # timeout after 10 seconds (default 75 seconds)
        backends {              # `backends` defines which host:ports will be proxied to
            server 127.0.0.1:80;    # one or more `server` host:ports required
            server 10.0.0.2:80;
        }
        access_log /Users/adonis/tmp/web_access.log;    # Optional Access log file
        error_log /Users/adonis/tmp/web_error.log;      # Optional error log file
    }
    service {
        server_name mysql;
        listen 0.0.0.0:3306;
        balance leastconn;
        keepalive_timeout 10;
        backends {
            server 192.168.64.5:3306;
            server 192.168.64.5:3306;
        }
    }
}

```
