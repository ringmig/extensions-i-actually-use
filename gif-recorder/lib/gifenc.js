/**
 * gifenc - Fast GIF Encoder
 * Bundled from https://github.com/mattdesl/gifenc (MIT License)
 * Copyright (c) Matt DesLauriers
 *
 * Includes: GIFEncoder, quantize (PnnQuant), applyPalette, LZW encoder
 */

(function () {
  'use strict';

  // ========== Constants ==========

  var constants = {
    trailer: 0x3b
  };

  // ========== Utilities ==========

  function sqr(value) {
    return value * value;
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  // ========== RGB Packing ==========

  function rgb888_to_rgb565(r, g, b) {
    return ((r << 8) & 0xf800) | ((g << 2) & 0x03e0) | (b >> 3);
  }

  function rgba8888_to_rgba4444(r, g, b, a) {
    return (r >> 4) | (g & 0xf0) | ((b & 0xf0) << 4) | ((a & 0xf0) << 8);
  }

  function rgb888_to_rgb444(r, g, b) {
    return ((r >> 4) << 8) | (g & 0xf0) | (b >> 4);
  }

  // ========== Color Distance ==========

  function euclideanDistanceSquared(a, b) {
    var sum = 0;
    for (var n = 0; n < a.length; n++) {
      var dx = a[n] - b[n];
      sum += dx * dx;
    }
    return sum;
  }

  // ========== Stream ==========

  function createStream(initialCapacity) {
    if (initialCapacity === undefined) initialCapacity = 256;
    var cursor = 0;
    var contents = new Uint8Array(initialCapacity);

    return {
      get buffer() { return contents.buffer; },
      reset: function () { cursor = 0; },
      bytesView: function () { return contents.subarray(0, cursor); },
      bytes: function () { return contents.slice(0, cursor); },
      writeByte: function (byte) {
        expand(cursor + 1);
        contents[cursor] = byte;
        cursor++;
      },
      writeBytes: function (data, offset, byteLength) {
        if (offset === undefined) offset = 0;
        if (byteLength === undefined) byteLength = data.length;
        expand(cursor + byteLength);
        for (var i = 0; i < byteLength; i++) {
          contents[cursor++] = data[i + offset];
        }
      },
      writeBytesView: function (data, offset, byteLength) {
        if (offset === undefined) offset = 0;
        if (byteLength === undefined) byteLength = data.byteLength;
        expand(cursor + byteLength);
        contents.set(data.subarray(offset, offset + byteLength), cursor);
        cursor += byteLength;
      }
    };

    function expand(newCapacity) {
      var prevCapacity = contents.length;
      if (prevCapacity >= newCapacity) return;
      var CAPACITY_DOUBLING_MAX = 1024 * 1024;
      newCapacity = Math.max(
        newCapacity,
        (prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2.0 : 1.125)) >>> 0
      );
      if (prevCapacity !== 0) newCapacity = Math.max(newCapacity, 256);
      var oldContents = contents;
      contents = new Uint8Array(newCapacity);
      if (cursor > 0) contents.set(oldContents.subarray(0, cursor), 0);
    }
  }

  // ========== LZW Encoder ==========

  var EOF = -1;
  var BITS = 12;
  var DEFAULT_HSIZE = 5003;
  var MASKS = [
    0x0000, 0x0001, 0x0003, 0x0007, 0x000f, 0x001f, 0x003f, 0x007f,
    0x00ff, 0x01ff, 0x03ff, 0x07ff, 0x0fff, 0x1fff, 0x3fff, 0x7fff, 0xffff
  ];

  function lzwEncode(width, height, pixels, colorDepth, outStream, accum, htab, codetab) {
    if (!outStream) outStream = createStream(512);
    if (!accum) accum = new Uint8Array(256);
    if (!htab) htab = new Int32Array(DEFAULT_HSIZE);
    if (!codetab) codetab = new Int32Array(DEFAULT_HSIZE);

    var hsize = htab.length;
    var initCodeSize = Math.max(2, colorDepth);

    accum.fill(0);
    codetab.fill(0);
    htab.fill(-1);

    var cur_accum = 0;
    var cur_bits = 0;
    var init_bits = initCodeSize + 1;
    var g_init_bits = init_bits;
    var clear_flg = false;
    var n_bits = g_init_bits;
    var maxcode = (1 << n_bits) - 1;
    var ClearCode = 1 << (init_bits - 1);
    var EOFCode = ClearCode + 1;
    var free_ent = ClearCode + 2;
    var a_count = 0;
    var ent = pixels[0];

    var hshift = 0;
    for (var fcode = hsize; fcode < 65536; fcode *= 2) ++hshift;
    hshift = 8 - hshift;

    outStream.writeByte(initCodeSize);
    output(ClearCode);

    var length = pixels.length;
    for (var idx = 1; idx < length; idx++) {
      next_block: {
        var c = pixels[idx];
        var fc = (c << BITS) + ent;
        var i = (c << hshift) ^ ent;
        if (htab[i] === fc) {
          ent = codetab[i];
          break next_block;
        }

        var disp = i === 0 ? 1 : hsize - i;
        while (htab[i] >= 0) {
          i -= disp;
          if (i < 0) i += hsize;
          if (htab[i] === fc) {
            ent = codetab[i];
            break next_block;
          }
        }
        output(ent);
        ent = c;
        if (free_ent < 1 << BITS) {
          codetab[i] = free_ent++;
          htab[i] = fc;
        } else {
          htab.fill(-1);
          free_ent = ClearCode + 2;
          clear_flg = true;
          output(ClearCode);
        }
      }
    }

    output(ent);
    output(EOFCode);
    outStream.writeByte(0);
    return outStream.bytesView();

    function output(code) {
      cur_accum &= MASKS[cur_bits];
      if (cur_bits > 0) cur_accum |= code << cur_bits;
      else cur_accum = code;
      cur_bits += n_bits;

      while (cur_bits >= 8) {
        accum[a_count++] = cur_accum & 0xff;
        if (a_count >= 254) {
          outStream.writeByte(a_count);
          outStream.writeBytesView(accum, 0, a_count);
          a_count = 0;
        }
        cur_accum >>= 8;
        cur_bits -= 8;
      }

      if (free_ent > maxcode || clear_flg) {
        if (clear_flg) {
          n_bits = g_init_bits;
          maxcode = (1 << n_bits) - 1;
          clear_flg = false;
        } else {
          ++n_bits;
          maxcode = n_bits === BITS ? (1 << n_bits) : (1 << n_bits) - 1;
        }
      }

      if (code === EOFCode) {
        while (cur_bits > 0) {
          accum[a_count++] = cur_accum & 0xff;
          if (a_count >= 254) {
            outStream.writeByte(a_count);
            outStream.writeBytesView(accum, 0, a_count);
            a_count = 0;
          }
          cur_accum >>= 8;
          cur_bits -= 8;
        }
        if (a_count > 0) {
          outStream.writeByte(a_count);
          outStream.writeBytesView(accum, 0, a_count);
          a_count = 0;
        }
      }
    }
  }

  // ========== PnnQuant (Color Quantization) ==========

  function find_nn(bins, idx, hasAlpha) {
    var nn = 0;
    var err = 1e100;
    var bin1 = bins[idx];
    var n1 = bin1.cnt;
    var wa = bin1.ac;
    var wr = bin1.rc;
    var wg = bin1.gc;
    var wb = bin1.bc;

    for (var i = bin1.fw; i !== 0; i = bins[i].fw) {
      var bin = bins[i];
      var n2 = bin.cnt;
      var nerr2 = (n1 * n2) / (n1 + n2);
      if (nerr2 >= err) continue;

      var nerr = 0;
      if (hasAlpha) {
        nerr += nerr2 * sqr(bin.ac - wa);
        if (nerr >= err) continue;
      }
      nerr += nerr2 * sqr(bin.rc - wr);
      if (nerr >= err) continue;
      nerr += nerr2 * sqr(bin.gc - wg);
      if (nerr >= err) continue;
      nerr += nerr2 * sqr(bin.bc - wb);
      if (nerr >= err) continue;
      err = nerr;
      nn = i;
    }
    bin1.err = err;
    bin1.nn = nn;
  }

  function create_bin() {
    return { ac: 0, rc: 0, gc: 0, bc: 0, cnt: 0, nn: 0, fw: 0, bk: 0, tm: 0, mtm: 0, err: 0 };
  }

  function create_bin_list(data, format) {
    var bincount = format === 'rgb444' ? 4096 : 65536;
    var bins = new Array(bincount);
    var size = data.length;

    if (format === 'rgba4444') {
      for (var i = 0; i < size; ++i) {
        var color = data[i];
        var a = (color >> 24) & 0xff;
        var b = (color >> 16) & 0xff;
        var g = (color >> 8) & 0xff;
        var r = color & 0xff;
        var index = rgba8888_to_rgba4444(r, g, b, a);
        var bin = index in bins ? bins[index] : (bins[index] = create_bin());
        bin.rc += r; bin.gc += g; bin.bc += b; bin.ac += a; bin.cnt++;
      }
    } else if (format === 'rgb444') {
      for (var i = 0; i < size; ++i) {
        var color = data[i];
        var b = (color >> 16) & 0xff;
        var g = (color >> 8) & 0xff;
        var r = color & 0xff;
        var index = rgb888_to_rgb444(r, g, b);
        var bin = index in bins ? bins[index] : (bins[index] = create_bin());
        bin.rc += r; bin.gc += g; bin.bc += b; bin.cnt++;
      }
    } else {
      for (var i = 0; i < size; ++i) {
        var color = data[i];
        var b = (color >> 16) & 0xff;
        var g = (color >> 8) & 0xff;
        var r = color & 0xff;
        var index = rgb888_to_rgb565(r, g, b);
        var bin = index in bins ? bins[index] : (bins[index] = create_bin());
        bin.rc += r; bin.gc += g; bin.bc += b; bin.cnt++;
      }
    }
    return bins;
  }

  function existsInPalette(palette, color) {
    for (var i = 0; i < palette.length; i++) {
      var p = palette[i];
      var matchesRGB = p[0] === color[0] && p[1] === color[1] && p[2] === color[2];
      var matchesAlpha = p.length >= 4 && color.length >= 4 ? p[3] === color[3] : true;
      if (matchesRGB && matchesAlpha) return true;
    }
    return false;
  }

  function quantize(rgba, maxColors, opts) {
    if (!opts) opts = {};
    var format = opts.format || 'rgb565';
    var clearAlpha = opts.clearAlpha !== undefined ? opts.clearAlpha : true;
    var clearAlphaColor = opts.clearAlphaColor || 0x00;
    var clearAlphaThreshold = opts.clearAlphaThreshold || 0;
    var oneBitAlpha = opts.oneBitAlpha || false;

    if (!rgba || !rgba.buffer) {
      throw new Error('quantize() expected RGBA Uint8Array data');
    }

    var data = new Uint32Array(rgba.buffer);
    var useSqrt = opts.useSqrt !== false;
    var hasAlpha = format === 'rgba4444';
    var bins = create_bin_list(data, format);
    var bincount = bins.length;
    var bincountMinusOne = bincount - 1;
    var heap = new Uint32Array(bincount + 1);

    var maxbins = 0;
    for (var i = 0; i < bincount; ++i) {
      var bin = bins[i];
      if (bin != null) {
        var d = 1.0 / bin.cnt;
        if (hasAlpha) bin.ac *= d;
        bin.rc *= d;
        bin.gc *= d;
        bin.bc *= d;
        bins[maxbins++] = bin;
      }
    }

    if (sqr(maxColors) / maxbins < 0.022) useSqrt = false;

    var i = 0;
    for (; i < maxbins - 1; ++i) {
      bins[i].fw = i + 1;
      bins[i + 1].bk = i;
      if (useSqrt) bins[i].cnt = Math.sqrt(bins[i].cnt);
    }
    if (useSqrt) bins[i].cnt = Math.sqrt(bins[i].cnt);

    var h, l, l2;
    for (i = 0; i < maxbins; ++i) {
      find_nn(bins, i, false);
      var err = bins[i].err;
      for (l = ++heap[0]; l > 1; l = l2) {
        l2 = l >> 1;
        if (bins[(h = heap[l2])].err <= err) break;
        heap[l] = h;
      }
      heap[l] = i;
    }

    var extbins = maxbins - maxColors;
    for (i = 0; i < extbins;) {
      var tb;
      for (;;) {
        var b1 = heap[1];
        tb = bins[b1];
        if (tb.tm >= tb.mtm && bins[tb.nn].mtm <= tb.tm) break;
        if (tb.mtm === bincountMinusOne) b1 = heap[1] = heap[heap[0]--];
        else {
          find_nn(bins, b1, false);
          tb.tm = i;
        }
        var err = bins[b1].err;
        for (l = 1; (l2 = l + l) <= heap[0]; l = l2) {
          if (l2 < heap[0] && bins[heap[l2]].err > bins[heap[l2 + 1]].err) l2++;
          if (err <= bins[(h = heap[l2])].err) break;
          heap[l] = h;
        }
        heap[l] = b1;
      }

      var nb = bins[tb.nn];
      var n1 = tb.cnt;
      var n2 = nb.cnt;
      var d = 1.0 / (n1 + n2);
      if (hasAlpha) tb.ac = d * (n1 * tb.ac + n2 * nb.ac);
      tb.rc = d * (n1 * tb.rc + n2 * nb.rc);
      tb.gc = d * (n1 * tb.gc + n2 * nb.gc);
      tb.bc = d * (n1 * tb.bc + n2 * nb.bc);
      tb.cnt += nb.cnt;
      tb.mtm = ++i;

      bins[nb.bk].fw = nb.fw;
      bins[nb.fw].bk = nb.bk;
      nb.mtm = bincountMinusOne;
    }

    var palette = [];
    var k = 0;
    for (i = 0; ; ++k) {
      var r = clamp(Math.round(bins[i].rc), 0, 0xff);
      var g = clamp(Math.round(bins[i].gc), 0, 0xff);
      var b = clamp(Math.round(bins[i].bc), 0, 0xff);
      var a = 0xff;
      if (hasAlpha) {
        a = clamp(Math.round(bins[i].ac), 0, 0xff);
        if (oneBitAlpha) {
          var threshold = typeof oneBitAlpha === 'number' ? oneBitAlpha : 127;
          a = a <= threshold ? 0x00 : 0xff;
        }
        if (clearAlpha && a <= clearAlphaThreshold) {
          r = g = b = clearAlphaColor;
          a = 0x00;
        }
      }
      var color = hasAlpha ? [r, g, b, a] : [r, g, b];
      if (!existsInPalette(palette, color)) palette.push(color);
      if ((i = bins[i].fw) === 0) break;
    }

    return palette;
  }

  // ========== Palettize (Apply Palette) ==========

  function nearestColorIndexRGBA(r, g, b, a, palette) {
    var k = 0, mindist = 1e100;
    for (var i = 0; i < palette.length; i++) {
      var px2 = palette[i];
      var curdist = sqr(px2[3] - a);
      if (curdist > mindist) continue;
      curdist += sqr(px2[0] - r);
      if (curdist > mindist) continue;
      curdist += sqr(px2[1] - g);
      if (curdist > mindist) continue;
      curdist += sqr(px2[2] - b);
      if (curdist > mindist) continue;
      mindist = curdist;
      k = i;
    }
    return k;
  }

  function nearestColorIndexRGB(r, g, b, palette) {
    var k = 0, mindist = 1e100;
    for (var i = 0; i < palette.length; i++) {
      var px2 = palette[i];
      var curdist = sqr(px2[0] - r);
      if (curdist > mindist) continue;
      curdist += sqr(px2[1] - g);
      if (curdist > mindist) continue;
      curdist += sqr(px2[2] - b);
      if (curdist > mindist) continue;
      mindist = curdist;
      k = i;
    }
    return k;
  }

  function applyPalette(rgba, palette, format) {
    if (!format) format = 'rgb565';

    if (!rgba || !rgba.buffer) {
      throw new Error('applyPalette() expected RGBA Uint8Array data');
    }
    if (palette.length > 256) {
      throw new Error('applyPalette() only works with 256 colors or less');
    }

    var data = new Uint32Array(rgba.buffer);
    var length = data.length;
    var bincount = format === 'rgb444' ? 4096 : 65536;
    var index = new Uint8Array(length);
    var cache = new Array(bincount);

    if (format === 'rgba4444') {
      for (var i = 0; i < length; i++) {
        var color = data[i];
        var a = (color >> 24) & 0xff;
        var b = (color >> 16) & 0xff;
        var g = (color >> 8) & 0xff;
        var r = color & 0xff;
        var key = rgba8888_to_rgba4444(r, g, b, a);
        index[i] = key in cache ? cache[key] : (cache[key] = nearestColorIndexRGBA(r, g, b, a, palette));
      }
    } else {
      var rgb888_to_key = format === 'rgb444' ? rgb888_to_rgb444 : rgb888_to_rgb565;
      for (var i = 0; i < length; i++) {
        var color = data[i];
        var b = (color >> 16) & 0xff;
        var g = (color >> 8) & 0xff;
        var r = color & 0xff;
        var key = rgb888_to_key(r, g, b);
        index[i] = key in cache ? cache[key] : (cache[key] = nearestColorIndexRGB(r, g, b, palette));
      }
    }

    return index;
  }

  // ========== GIF Encoder ==========

  function GIFEncoder(opt) {
    if (!opt) opt = {};
    var initialCapacity = opt.initialCapacity || 4096;
    var auto = opt.auto !== undefined ? opt.auto : true;

    var stream = createStream(initialCapacity);
    var HSIZE = 5003;
    var accum = new Uint8Array(256);
    var htab = new Int32Array(HSIZE);
    var codetab = new Int32Array(HSIZE);
    var hasInit = false;

    return {
      reset: function () {
        stream.reset();
        hasInit = false;
      },
      finish: function () {
        stream.writeByte(constants.trailer);
      },
      bytes: function () {
        return stream.bytes();
      },
      bytesView: function () {
        return stream.bytesView();
      },
      get buffer() { return stream.buffer; },
      get stream() { return stream; },
      writeHeader: writeHeader,
      writeFrame: function (index, width, height, opts) {
        if (!opts) opts = {};
        var transparent = opts.transparent || false;
        var transparentIndex = opts.transparentIndex || 0x00;
        var delay = opts.delay || 0;
        var palette = opts.palette || null;
        var repeat = opts.repeat !== undefined ? opts.repeat : 0;
        var colorDepth = opts.colorDepth || 8;
        var dispose = opts.dispose !== undefined ? opts.dispose : -1;

        var first = false;
        if (auto) {
          if (!hasInit) {
            first = true;
            writeHeader();
            hasInit = true;
          }
        } else {
          first = Boolean(opts.first);
        }

        width = Math.max(0, Math.floor(width));
        height = Math.max(0, Math.floor(height));

        if (first) {
          if (!palette) throw new Error('First frame must include a { palette } option');
          encodeLogicalScreenDescriptor(stream, width, height, palette, colorDepth);
          encodeColorTable(stream, palette);
          if (repeat >= 0) encodeNetscapeExt(stream, repeat);
        }

        var delayTime = Math.round(delay / 10);
        encodeGraphicControlExt(stream, dispose, delayTime, transparent, transparentIndex);

        var useLocalColorTable = Boolean(palette) && !first;
        encodeImageDescriptor(stream, width, height, useLocalColorTable ? palette : null);
        if (useLocalColorTable) encodeColorTable(stream, palette);
        encodePixels(stream, index, width, height, colorDepth, accum, htab, codetab);
      }
    };

    function writeHeader() {
      writeUTFBytes(stream, 'GIF89a');
    }
  }

  function encodeGraphicControlExt(stream, dispose, delay, transparent, transparentIndex) {
    stream.writeByte(0x21);
    stream.writeByte(0xf9);
    stream.writeByte(4);

    if (transparentIndex < 0) {
      transparentIndex = 0x00;
      transparent = false;
    }

    var transp, disp;
    if (!transparent) {
      transp = 0;
      disp = 0;
    } else {
      transp = 1;
      disp = 2;
    }
    if (dispose >= 0) disp = dispose & 7;
    disp <<= 2;

    stream.writeByte(0 | disp | 0 | transp);
    writeUInt16(stream, delay);
    stream.writeByte(transparentIndex || 0x00);
    stream.writeByte(0);
  }

  function encodeLogicalScreenDescriptor(stream, width, height, palette, colorDepth) {
    if (!colorDepth) colorDepth = 8;
    var globalColorTableSize = colorTableSize(palette.length) - 1;
    var fields = (1 << 7) | ((colorDepth - 1) << 4) | (0 << 3) | globalColorTableSize;
    writeUInt16(stream, width);
    writeUInt16(stream, height);
    stream.writeBytes([fields, 0, 0]);
  }

  function encodeNetscapeExt(stream, repeat) {
    stream.writeByte(0x21);
    stream.writeByte(0xff);
    stream.writeByte(11);
    writeUTFBytes(stream, 'NETSCAPE2.0');
    stream.writeByte(3);
    stream.writeByte(1);
    writeUInt16(stream, repeat);
    stream.writeByte(0);
  }

  function encodeColorTable(stream, palette) {
    var colorTableLength = 1 << colorTableSize(palette.length);
    for (var i = 0; i < colorTableLength; i++) {
      var color = [0, 0, 0];
      if (i < palette.length) color = palette[i];
      stream.writeByte(color[0]);
      stream.writeByte(color[1]);
      stream.writeByte(color[2]);
    }
  }

  function encodeImageDescriptor(stream, width, height, localPalette) {
    stream.writeByte(0x2c);
    writeUInt16(stream, 0);
    writeUInt16(stream, 0);
    writeUInt16(stream, width);
    writeUInt16(stream, height);

    if (localPalette) {
      var palSize = colorTableSize(localPalette.length) - 1;
      stream.writeByte(0x80 | 0 | 0 | 0 | palSize);
    } else {
      stream.writeByte(0);
    }
  }

  function encodePixels(stream, index, width, height, colorDepth, accum, htab, codetab) {
    if (!colorDepth) colorDepth = 8;
    lzwEncode(width, height, index, colorDepth, stream, accum, htab, codetab);
  }

  function writeUInt16(stream, short) {
    stream.writeByte(short & 0xff);
    stream.writeByte((short >> 8) & 0xff);
  }

  function writeUTFBytes(stream, text) {
    for (var i = 0; i < text.length; i++) {
      stream.writeByte(text.charCodeAt(i));
    }
  }

  function colorTableSize(length) {
    return Math.max(Math.ceil(Math.log2(length)), 1);
  }

  // ========== Expose API ==========

  window.gifenc = {
    GIFEncoder: GIFEncoder,
    quantize: quantize,
    applyPalette: applyPalette
  };

})();
