const dgram = require('dgram');


// STUN Server and Port Configuration
const STUN_SERVER = 'stun.l.google.com';
const STUN_PORT = 19302;
// Magic Cookie for STUN protocol (RFC 5389)
const MAGIC_COOKIE = 0x2112A442;
// Timeout for the STUN request (in milliseconds)
const TIMEOUT = 3000;
// STUN Message Types
const BINDING_REQUEST_TYPE = 0x0001;
const BINDING_RESPONSE_TYPE = 0x0101;
// XOR-MAPPED-ADDRESS Attribute Type
const XOR_MAPPED_ADDRESS_TYPE = 0x0020;


/**
 * Creates a correct STUN Binding Request message.
 * This message will be used to request the public IP and port from the STUN server.
 * @returns {Buffer} The STUN Binding Request message.
 */
const createStunBindingRequest = () => {
  const buffer = Buffer.alloc(20); // Total length for a simple Binding Request

  // Write STUN Binding Request header
  buffer.writeUInt16BE(BINDING_REQUEST_TYPE, 0); // Message Type: Binding Request (0x0001)
  buffer.writeUInt16BE(0x0000, 2); // Message Length (0 for Binding Request)
  buffer.writeUInt32BE(MAGIC_COOKIE, 4); // Magic Cookie

  // Generate 12 random bytes for the Transaction ID
  for (let i = 8; i < 20; i++) {
    buffer[i] = Math.floor(Math.random() * 256);  // Random bytes
  }

  return buffer;
};

/**
 * Decodes the XOR-MAPPED-ADDRESS attribute from the STUN response.
 * The XOR-MAPPED-ADDRESS contains the public IP and port of the client.
 * @param {Buffer} msg - The STUN Binding Response message received from the server.
 * @returns {Object} An object containing the decoded IP and port.
 */
const decodeXorAddress = (msg) => {
  let offset = 20; // Skip the STUN header

  // Search for the XOR-MAPPED-ADDRESS attribute
  while (offset < msg.length) {
    const attrType = msg.readUInt16BE(offset);
    const attrLength = msg.readUInt16BE(offset + 2);

    if (attrType === XOR_MAPPED_ADDRESS_TYPE) { // Found XOR-MAPPED-ADDRESS
      const family = msg.readUInt8(offset + 5); // Address family (IPv4 or IPv6)
      const xPort = msg.readUInt16BE(offset + 6); // XOR'd port
      const port = xPort ^ (MAGIC_COOKIE >>> 16); // Decode the port

      // Decode the IP address by XOR'ing with the magic cookie
      const ipBytes = [];
      for (let i = 0; i < 4; i++) {
        const magicByte = (MAGIC_COOKIE >>> (24 - i * 8)) & 0xFF;
        const encodedByte = msg.readUInt8(offset + 8 + i);
        ipBytes.push(encodedByte ^ magicByte);
      }

      return {
        ip: ipBytes.join('.'), // Convert the byte array into an IP string
        port: port
      };
    }

    // Move to the next attribute
    offset += 4 + attrLength + (attrLength % 4 ? 4 - attrLength % 4 : 0);
  }

  // If no XOR-MAPPED-ADDRESS was found, throw an error
  throw new Error('No XOR-MAPPED-ADDRESS found in STUN response');
};


/**
 * Retrieves the public IP and port using a STUN request to a STUN server.
 * @returns {Promise<Object>} Resolves with an object containing the public IP and port.
 */
const getPublicAddress = async () => {
  const socket = dgram.createSocket('udp4');
  let isClosed = false; // Flag to ensure the socket is closed only once

  // Function to close the socket safely (only once)
  const closeSocket = () => {
    if (!isClosed) {
      isClosed = true;
      socket.close();
    }
  };

  return new Promise((resolve, reject) => {
    const msg = createStunBindingRequest(); // Create the Binding Request message

    // Handle socket errors
    socket.on('error', (err) => {
      reject(new Error(`Socket error: ${err.message}`));
      closeSocket();
    });

    // Send the STUN Binding Request message to the server
    socket.send(msg, 0, msg.length, STUN_PORT, STUN_SERVER, (err) => {
      if (err) {
        reject(new Error('Failed to send STUN request'));
        closeSocket();
      }
    });

    // Handle the response from the STUN server
    socket.on('message', (responseMsg) => {
      try {
        // Verify that this is a Binding Response
        if (responseMsg.readUInt16BE(0) !== BINDING_RESPONSE_TYPE) {
          throw new Error('Invalid STUN response');
        }

        // Decode the XOR-MAPPED-ADDRESS to get public IP and port
        const result = decodeXorAddress(responseMsg);
        closeSocket();
        resolve(result); // Resolve the promise with the public IP and port
      } catch (error) {
        closeSocket();
        reject(error); // Reject the promise if there is an error
      }
    });

    // Timeout handling (in case no response is received)
    setTimeout(() => {
      closeSocket();
      reject(new Error('STUN request timed out'));
    }, TIMEOUT);
  });
};


// Execute the function and print the results
getPublicAddress()
  .then((result) => {
    console.log('Public IP:', result.ip);
    console.log('Public Port:', result.port);
  })
  .catch((error) => {
    console.error('Error:', error.message);
  });

