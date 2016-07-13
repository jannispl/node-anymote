var noble = require('noble'),
	util = require('util'),
	EventEmitter = require('events').EventEmitter,
	ircode = require('./ircode');

// Constructor
function AnyMote(mac, options) {
	// Deal with forgotten "new"
	if (!(this instanceof AnyMote))
		return new AnyMote(mac, options);
	
	// Object properties
	this._peripheral = undefined;
	this._characteristics = {};
	this._options = options;
	this._incomingCodeBuffer = null;
	this._discardBufferTimeout = null;
	this.state = 'disconnected';

	// Create "this" reference for event handlers
	var self = this;

	// Connect event handler
	this.connectHandler = function ()
	{
		// Discover services and characteristics (filter serial data service)
		self._peripheral.discoverSomeServicesAndCharacteristics(['ffa0', '180a', '180f'], [],
								function (err, services, characteristics) {
			for (var i in characteristics)
			{
				var characteristic = characteristics[i];
				self._characteristics[characteristic.uuid] = characteristic;
			}

			if (self._characteristics['ffa3'])
			{
				self._characteristics['ffa3'].write(new Buffer(self._options.authId || [0x03,0x03,0x03,0x03]), false, self.authenticatedHandler);
			}

			if (self._characteristics['ffa1'])
			{
				self._characteristics['ffa1'].on('data', self.incomingCodeHandler);
			}
		});
	};

	this.authenticatedHandler = function (err)
	{
		if (err)
			throw err;

		self.state = 'connected';
		self.emit('connect');
	};

	this.discardCodeBuffer = function ()
	{
		self._incomingCodeBuffer = null;
	};

	this.incomingCodeHandler = function (data, isNotification)
	{
		if (!isNotification)
			return;

		if (self._discardBufferTimeout)
		{
			clearTimeout(self._discardBufferTimeout);
			self._discardBufferTimeout = null;
		}

		console.log(data);

		var endIdx = data.indexOf(0x00);
		if (endIdx !== -1)
		{
			var codePart = data.slice(0, endIdx);
			//var repeatCount = data[endIdx + 1];
			if (codePart.length > 0)
				self._incomingCodeBuffer = self._incomingCodeBuffer ? Buffer.concat([self._incomingCodeBuffer, codePart], self._incomingCodeBuffer.length + codePart.length) : codePart;

			// HANDLE HERE
			var result = {
				frequency: self._incomingCodeBuffer[0] * 250,
				pattern: ircode.decodeBLE(self._incomingCodeBuffer.slice(1))
			};
			self.emit('record', result);
			
			//console.log('REPEATCOUNT: ' + repeatCount);
			//

			self._incomingCodeBuffer = data.slice(endIdx + 2);
			//console.log('rest in buf: ' + buf.length);
		}
		else
			self._incomingCodeBuffer = self._incomingCodeBuffer ? Buffer.concat([self._incomingCodeBuffer, data]) : data;

		if (self._incomingCodeBuffer.length > 0)
		{
			self._discardBufferTimeout = setTimeout(self.discardCodeBuffer, 4000);
		}
	};
	
	// Disconnect event handler
	this.disconnectHandler = function () {
		// Get rid of the peripheral and characteristic references
		self._characteristics = {};
		delete self._peripheral;

		self.state = 'disconnected';
		// Emit 'disconnect' event
		self.emit('disconnect');

		if (self._options.autoReconnect)
			self.reconnect();
	};

	this.startRecordingCode = function (cb) {
		self._characteristics['ffa1'].write(new Buffer([0x04]), false, function (err)
		{
			if (err)
			{
				if (cb) cb(err);
				return;
			}

			if (cb)
				cb(null);
		});
	};

	this.stopRecordingCode = function (cb) {
		self._characteristics['ffa1'].write(new Buffer([0x05]), false, function (err)
		{
			if (err)
			{
				if (cb) cb(err);
				return;
			}

			if (cb)
				cb(null);
		});
	};

	this.playPattern = function (freq, pattern, repeat, cb)
	{
		var encodedPattern = ircode.encodeBLE(pattern);
		var request = Buffer.concat([new Buffer([0x01, Math.round(freq/250)]), encodedPattern, new Buffer([0, repeat])], 2 + encodedPattern.length + 2);

		var buffers = [];
		while (request.length > 0)
		{
			var step = request.slice(0, Math.min(request.length, 20));
			request = request.slice(Math.min(request.length, 20));
			buffers.push(step);
		}

		var doStep = function (idx)
		{
			self._characteristics['ffa1'].write(buffers[idx], false, function (err)
			{
				if (err)
				{
					if (cb) cb(err);
					return;
				}

				if ((idx + 1) < buffers.length)
					doStep(idx + 1);
				else if (cb)
					cb(null);
			});
		}
		doStep(0);
	};

	this.readCharacteristicString = function (uuid, cb)
	{
		self._characteristics[uuid].read(function (err, data)
		{
			if (err)
			{
				if (cb) cb(err);
				return;
			}

			if (cb)
				cb(null, data.toString());
		});
	}

	this.readFirmwareVersion = function (cb)
	{
		self.readCharacteristicString('2a26', cb);
	};

	this.readHardwareVersion = function (cb)
	{
		self.readCharacteristicString('2a27', cb);
	};

	this.readBatteryLevel = function (cb)
	{
		self._characteristics['2a19'].read(function (err, data)
		{
			if (err)
			{
				if (cb) cb(err);
				return;
			}

			if (cb)
				cb(null, data[0]);
		});
	}

	this.reconnect = function ()
	{
		// Stop scanning event handler (which fires after we identified the
		// correct peripheral
		noble.once('scanStop', function () {
			// Prevent crash if no peripheral
			if (!self._peripheral) return;
			// Set connect and disconnect handlers
			self._peripheral.once('connect', self.connectHandler);
			self._peripheral.once('disconnect', self.disconnectHandler);
			// Try to connect
			self._peripheral.connect();
		});
			
		// Discover event handler
		noble.once('discover', function(peripheral) {
			// No MAC was specified, or if one was, it matches our discovered MAC
			if (!mac || mac == peripheral.uuid) {
				// Save the peripheral
				self._peripheral = peripheral;
				// Stop scanning
				noble.stopScanning();
			}
		});
		
		// Start scanning (filter anymote service)
		noble.startScanning(['ffa0'], true);
	};

	this.reconnect();
}

// Close our BLE connection on "end"
AnyMote.prototype.end = function (chunk, encoding, callback) {
	// But also disconnect the BLE or stop scanning if we weren't
	// connected yet
	if (this._peripheral) {
		this._peripheral.disconnect();
	} else {
		noble.stopScanning();
	}
}

util.inherits(AnyMote, EventEmitter);

// Make the BLE serial stream externally available
module.exports = AnyMote;
