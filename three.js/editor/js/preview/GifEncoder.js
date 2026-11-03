/**
 * GIF89a encoder for library previews.
 * One global palette (median cut), full-frame replacement, infinite loop.
 */

function quantizeFrames( frames, width, height, maxColors ) {

	const hist = new Map();
	const pixelCount = width * height;
	const step = Math.max( 1, Math.floor( ( pixelCount * frames.length ) / 24000 ) );
	let seen = 0;
	for ( let f = 0; f < frames.length; f ++ ) {

		const data = frames[ f ];
		for ( let i = 0; i < pixelCount; i += step ) {

			const o = i * 4;
			const key = ( data[ o ] << 16 ) | ( data[ o + 1 ] << 8 ) | data[ o + 2 ];
			const prev = hist.get( key );
			if ( prev ) prev[ 3 ] ++;
			else hist.set( key, [ data[ o ], data[ o + 1 ], data[ o + 2 ], 1 ] );
			seen ++;

		}

	}

	let colors = Array.from( hist.values() );
	if ( colors.length === 0 ) colors = [ [ 0, 0, 0, 1 ] ];
	const target = Math.max( 2, Math.min( 256, maxColors ) );
	const palette = medianCut( colors, target );
	while ( palette.length < 2 ) palette.push( [ 0, 0, 0 ] );
	const padded = nextPow2( palette.length );
	while ( palette.length < padded ) palette.push( [ 0, 0, 0 ] );
	return { palette, lut: buildLut( palette ), sampled: seen };

}

function nextPow2( n ) {

	let p = 2;
	while ( p < n ) p <<= 1;
	return Math.min( 256, p );

}

function channelRange( box ) {

	let r0 = 255, r1 = 0, g0 = 255, g1 = 0, b0 = 255, b1 = 0;
	for ( let i = 0; i < box.length; i ++ ) {

		const c = box[ i ];
		if ( c[ 0 ] < r0 ) r0 = c[ 0 ];
		if ( c[ 0 ] > r1 ) r1 = c[ 0 ];
		if ( c[ 1 ] < g0 ) g0 = c[ 1 ];
		if ( c[ 1 ] > g1 ) g1 = c[ 1 ];
		if ( c[ 2 ] < b0 ) b0 = c[ 2 ];
		if ( c[ 2 ] > b1 ) b1 = c[ 2 ];

	}

	const rr = r1 - r0;
	const gg = g1 - g0;
	const bb = b1 - b0;
	if ( rr >= gg && rr >= bb ) return { channel: 0, range: rr };
	if ( gg >= rr && gg >= bb ) return { channel: 1, range: gg };
	return { channel: 2, range: bb };

}

function medianCut( colors, maxColors ) {

	let boxes = [ colors ];
	while ( boxes.length < maxColors ) {

		let best = - 1;
		let bestRange = 0;
		for ( let i = 0; i < boxes.length; i ++ ) {

			if ( boxes[ i ].length < 2 ) continue;
			const info = channelRange( boxes[ i ] );
			if ( info.range > bestRange ) {

				bestRange = info.range;
				best = i;

			}

		}

		if ( best < 0 || bestRange <= 0 ) break;
		const box = boxes[ best ];
		const channel = channelRange( box ).channel;
		box.sort( ( a, b ) => a[ channel ] - b[ channel ] );
		let total = 0;
		for ( let i = 0; i < box.length; i ++ ) total += box[ i ][ 3 ];
		let acc = 0;
		let split = Math.floor( box.length / 2 );
		for ( let i = 0; i < box.length - 1; i ++ ) {

			acc += box[ i ][ 3 ];
			if ( acc >= total / 2 ) {

				split = i + 1;
				break;

			}

		}

		split = Math.max( 1, Math.min( box.length - 1, split ) );
		boxes.splice( best, 1, box.slice( 0, split ), box.slice( split ) );

	}

	return boxes.map( ( box ) => {

		let r = 0, g = 0, b = 0, n = 0;
		for ( let i = 0; i < box.length; i ++ ) {

			const c = box[ i ];
			r += c[ 0 ] * c[ 3 ];
			g += c[ 1 ] * c[ 3 ];
			b += c[ 2 ] * c[ 3 ];
			n += c[ 3 ];

		}

		n = Math.max( 1, n );
		return [ Math.round( r / n ), Math.round( g / n ), Math.round( b / n ) ];

	} );

}

function buildLut( palette ) {

	const lut = new Uint8Array( 32 * 32 * 32 );
	for ( let r = 0; r < 32; r ++ ) {

		for ( let g = 0; g < 32; g ++ ) {

			for ( let b = 0; b < 32; b ++ ) {

				const R = r * 8 + 4;
				const G = g * 8 + 4;
				const B = b * 8 + 4;
				let best = 0;
				let bestD = 1e12;
				for ( let i = 0; i < palette.length; i ++ ) {

					const dr = palette[ i ][ 0 ] - R;
					const dg = palette[ i ][ 1 ] - G;
					const db = palette[ i ][ 2 ] - B;
					const d = dr * dr + dg * dg + db * db;
					if ( d < bestD ) {

						bestD = d;
						best = i;

					}

				}

				lut[ ( r << 10 ) | ( g << 5 ) | b ] = best;

			}

		}

	}

	return lut;

}

function indexFrame( data, lut ) {

	const indices = new Uint8Array( data.length / 4 );
	for ( let i = 0, p = 0; i < indices.length; i ++, p += 4 ) {

		indices[ i ] = lut[ ( ( data[ p ] >> 3 ) << 10 ) | ( ( data[ p + 1 ] >> 3 ) << 5 ) | ( data[ p + 2 ] >> 3 ) ];

	}

	return indices;

}

function lzwEncode( pixels, minCodeSize ) {

	// Same table growth as the GIF89a compress used by gifenc / gif.js.
	const BITS = 12;
	const HSIZE = 5003;
	const htab = new Int32Array( HSIZE );
	const codetab = new Int32Array( HSIZE );
	htab.fill( - 1 );

	const initCodeSize = Math.max( 2, minCodeSize );
	const gInitBits = initCodeSize + 1;
	let clearFlag = false;
	let nBits = gInitBits;
	let maxCode = ( 1 << nBits ) - 1;
	const clearCode = 1 << initCodeSize;
	const eoiCode = clearCode + 1;
	let freeEnt = clearCode + 2;

	let hshift = 0;
	for ( let fcode = HSIZE; fcode < 65536; fcode *= 2 ) hshift ++;
	hshift = 8 - hshift;

	const bytes = [];
	let acc = 0;
	let accBits = 0;

	function output( code ) {

		acc &= ( 1 << accBits ) - 1;
		if ( accBits > 0 ) acc |= code << accBits;
		else acc = code;
		accBits += nBits;
		while ( accBits >= 8 ) {

			bytes.push( acc & 255 );
			acc >>= 8;
			accBits -= 8;

		}

		if ( freeEnt > maxCode || clearFlag ) {

			if ( clearFlag ) {

				nBits = gInitBits;
				maxCode = ( 1 << nBits ) - 1;
				clearFlag = false;

			} else {

				nBits ++;
				maxCode = nBits === BITS ? ( 1 << nBits ) : ( 1 << nBits ) - 1;

			}

		}

		if ( code === eoiCode ) {

			while ( accBits > 0 ) {

				bytes.push( acc & 255 );
				acc >>= 8;
				accBits -= 8;

			}

		}

	}

	if ( ! pixels.length ) {

		output( clearCode );
		output( eoiCode );
		return bytes;

	}

	output( clearCode );
	let ent = pixels[ 0 ];
	pixel: for ( let idx = 1; idx < pixels.length; idx ++ ) {

		const c = pixels[ idx ];
		const fcode = ( c << BITS ) + ent;
		let i = ( c << hshift ) ^ ent;
		if ( htab[ i ] === fcode ) {

			ent = codetab[ i ];
			continue;

		}

		const disp = i === 0 ? 1 : HSIZE - i;
		while ( htab[ i ] >= 0 ) {

			i -= disp;
			if ( i < 0 ) i += HSIZE;
			if ( htab[ i ] === fcode ) {

				ent = codetab[ i ];
				continue pixel;

			}

		}

		output( ent );
		ent = c;
		if ( freeEnt < ( 1 << BITS ) ) {

			codetab[ i ] = freeEnt ++;
			htab[ i ] = fcode;

		} else {

			htab.fill( - 1 );
			freeEnt = clearCode + 2;
			clearFlag = true;
			output( clearCode );

		}

	}

	output( ent );
	output( eoiCode );
	return bytes;

}

function u16( n ) {

	return [ n & 255, ( n >> 8 ) & 255 ];

}

/**
 * @param {{ width: number, height: number, frames: Uint8ClampedArray[], delayCs: number, maxColors?: number }} opts
 * @returns {Uint8Array}
 */
export function encodeGif( opts ) {

	const width = opts.width | 0;
	const height = opts.height | 0;
	const frames = opts.frames || [];
	const delayCs = Math.max( 2, opts.delayCs | 0 );
	const maxColors = opts.maxColors || 256;
	const { palette } = quantizeFrames( frames, width, height, maxColors );
	const lut = buildLut( palette );
	const colorBits = Math.round( Math.log2( palette.length ) );
	const minCodeSize = Math.max( 2, colorBits );
	const packed = 0x80 | ( ( colorBits - 1 ) << 4 ) | ( colorBits - 1 );

	const out = [ 0x47, 0x49, 0x46, 0x38, 0x39, 0x61 ];
	out.push( ...u16( width ), ...u16( height ), packed, 0, 0 );
	for ( let i = 0; i < palette.length; i ++ ) {

		out.push( palette[ i ][ 0 ], palette[ i ][ 1 ], palette[ i ][ 2 ] );

	}

	// Netscape loop
	out.push(
		0x21, 0xFF, 11,
		0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30,
		3, 1, 0, 0, 0
	);

	for ( let f = 0; f < frames.length; f ++ ) {

		const indices = indexFrame( frames[ f ], lut );
		const lzw = lzwEncode( indices, minCodeSize );
		out.push( 0x21, 0xF9, 4, 0x04, delayCs & 255, ( delayCs >> 8 ) & 255, 0, 0 );
		out.push( 0x2C, 0, 0, 0, 0, ...u16( width ), ...u16( height ), 0 );
		out.push( minCodeSize );
		let i = 0;
		while ( i < lzw.length ) {

			const n = Math.min( 255, lzw.length - i );
			out.push( n );
			for ( let j = 0; j < n; j ++ ) out.push( lzw[ i ++ ] );

		}

		out.push( 0 );

	}

	out.push( 0x3B );
	return Uint8Array.from( out );

}
