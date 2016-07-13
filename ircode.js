var decodeBLE = exports.decodeBLE = function (inputBuffer)
{
	var finalCode = [];
	for (var i = 0; i < inputBuffer.length; ++i)
	{
		var byte = inputBuffer.readUInt8(i);
		if (byte > 0x7F) // negative sign bit is set
		{
			++i;
			var nextByte = inputBuffer.readUInt8(i);
			var nextNum = inputBuffer.readInt8(i);

			//finalCode.push((256 - byte) + (nextByte << 7));
			finalCode.push(((256 - byte) << 7) + nextNum);
		}
		else
			finalCode.push(byte);
	}
	return finalCode;
};

var encodeBLE = exports.encodeBLE = function (inputArray)
{
	var result = [];
	for (var i in inputArray)
	{
		var num = inputArray[i];
		if (num > 0x7f)
		{
			var b1 = (num >>> 7) & 0x7f;
			var b2 = num & 0x7f;
			result.push(-b1);
			result.push(b2);

			/*var b2 = (num >> 7) & 0x7f;
			var b1 = (num & 0x7f);
			
			b1 = ~b1 + 1;
			result.push(b1);
			result.push(b2);*/
		}
		else
			result.push(num);
	}
	return new Buffer(result);
};

var parsePronto = exports.parsePronto = function (inputString)
{
	var parts = inputString.trim().split(' ');
	var bufSize = parts.length * 2;
	var buffer = new Buffer(bufSize);
	for (var i in parts)
	{
		var part = parts[i];
		var num = parseInt(part, 16);

		buffer.writeUInt16BE(num, i * 2);
	}
	return buffer;
};

var convertProntoToCode = exports.convertProntoToCode = function (inputBuffer)
{
	var frequency = inputBuffer.readUInt16BE(2);
	frequency = Math.round(1000000 / (frequency * 0.241246));

	var patternBuf = inputBuffer.slice(8);
	var pattern = [];
	for (var i = 0; i < patternBuf.length / 2; ++i)
	{
		var num = patternBuf.readUInt16BE(i * 2);
		if (num === 0)
			return null;

		pattern.push(num);
	}

	return {
		frequency: frequency,
		pattern: pattern
	};
};

var convertNecToPronto = exports.convertNecToPronto = function (nec)
{
	var strComp32BitBinary;
	var strBinary = nec.toString(2);
	var strResult;

	//convert to full 32 bit binary string
	if( strBinary.length < 32 ){
		var strZeros = "00000000000000000000000000000000"
		var strComp32BitBinary;
		strComp32BitBinary = strZeros.substring( 0, 32 - strBinary.length );
		strComp32BitBinary = strComp32BitBinary + strBinary;
	}else{
		strComp32BitBinary = strBinary;
	}

	strResult = "0000 006D 0022 0002 0155 00AA ";
	for (var j = 0; j < 4; ++j)
	{
		var strByte = strComp32BitBinary.substring(j * 8, (j + 1) * 8);

		for (var i = 0; i < 8; ++i)
		{
			if (strByte.charAt(7 - i) == '0')
				strResult += "0015 0015 ";
			else
				strResult += "0015 0040 ";
		}					
	}

	strResult += "0015 05ED 0155 0055 0015 0E47 0015";
	return strResult;
};

var convertNecToCode = exports.convertNecToCode = function (nec)
{
	var pronto = convertNecToPronto(nec);
	var parsed = parsePronto(pronto);
	return convertProntoToCode(parsed);
};
