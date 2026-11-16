// Loaded before application imports: fail on network attempts, not just source-code matches.
globalThis.blockedNetworkAttempts = 0;
const deny = () => { globalThis.blockedNetworkAttempts++; throw new Error('Network disabled for benchmark tests'); };
globalThis.fetch = deny;
for (const name of ['node:http', 'node:https']) { const api = require(name); api.request = deny; api.get = deny; }
const net = require('node:net'); net.connect = deny; net.createConnection = deny; net.Socket.prototype.connect = deny;
require('node:tls').connect = deny;
require('node:dgram').createSocket = deny;
require('node:dns').lookup = deny;
require('node:module').syncBuiltinESMExports();
process.on('exit', () => { if (globalThis.blockedNetworkAttempts) process.exitCode = 1; });
