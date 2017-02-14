// ==UserScript==
// @name        webmify
// @namespace   https://2ch.hk/webmify
// @description Allow to watch WebMs in Edge on some sites
// @downloadURL https://raw.githubusercontent.com/Kagami/webmify/master/webmify.user.js
// @updateURL   https://raw.githubusercontent.com/Kagami/webmify/master/webmify.user.js
// @include     https://2ch.hk/*
// @include     https://2ch.pm/*
// @version     0.2.0
// @grant       none
// ==/UserScript==

function Remuxer(data, keepCodec) {
  this.data = data;
  this.keepCodec = keepCodec;
  this.cur = 0;
  this.lacing = false;
}

Remuxer.Void = 0xec;
Remuxer.Segment = 0x18538067;
Remuxer.Tracks = 0x1654ae6b;
Remuxer.TrackEntry = 0xae;
Remuxer.TrackNumber = 0xd7;
Remuxer.CodecID = 0x86;
Remuxer.CodecID_VP9 = "V_VP9";
Remuxer.CodecID_Opus = "A_OPUS";
Remuxer.Cluster = 0x1f43b675;
Remuxer.SimpleBlock = 0xa3;
Remuxer.BlockGroup = 0xa0;
Remuxer.Block = 0xa1;

Remuxer.prototype._readCoded = function(keepMask) {
  // TODO: Reserved ID.
  var n = this.data[this.cur++];
  var len = 0;
  while (n < (0x80 >> len)) {
    len++;
  }
  // Element IDs are specified in storage format.
  if (!keepMask) {
    n ^= 0x80 >> len;
  }
  while (len--) {
    n = (n << 8) | this.data[this.cur++];
  }
  return n;
};

Remuxer.prototype.readID = function() {
  return this._readCoded(true);
};

Remuxer.prototype.readSize = function() {
  return this._readCoded(false);
};

Remuxer.prototype.readUInt = function(size) {
  var n = 0;
  while (size--) {
    n = (n << 8) | this.data[this.cur++];
  }
  return n;
};

Remuxer.prototype.readString = function(size) {
  // TODO: Remove zero-padding per spec?
  var s = "";
  while (size--) {
    s += String.fromCharCode(this.data[this.cur++]);
  }
  return s;
};

// Element IDs are specified in storage format.
Remuxer.prototype.writeID = function(value) {
  var n = value;
  var len = 0;
  var shift = 0;
  while (n > 0xff) {
    n >>= 8;
    len++;
  }
  shift = len * 8;
  do {
    this.data[this.cur++] = (value >> shift) & 0xff;
    shift -= 8;
  } while (len--);
};

Remuxer.prototype.writeSize = function(value) {
  var n = 0x80;
  var len = 0;
  var shift = 0;
  // "111 1111" is Reserved ID.
  while (value > (n - 2)) {
    n <<= 7;
    len++;
  }
  // Element Size doesn't include size of the coded data itself.
  value -= len + 1;
  shift = len * 8;
  this.data[this.cur++] = (0x80 >> len) | (value >> shift);
  while (len--) {
    shift -= 8;
    this.data[this.cur++] = (value >> shift) & 0xff;
  }
};

Remuxer.prototype._void = function(start, end) {
  var savedCur = this.cur;
  this.cur = start;
  this.writeID(Remuxer.Void);
  this.writeSize(end - this.cur);
  this.cur = savedCur;
};

Remuxer.prototype._hasLacing = function() {
  var flags = 0;
  // Assuming we're right at Timecode.
  // Skip Timecode (int16).
  this.cur += 2;
  flags = this.data[this.cur++];
  // 5-6 bits. 00 = no lacing.
  return (flags & 6) > 0;
};

// TODO: Error-resilience.
Remuxer.prototype.process = function() {
  var start = 0;
  var element = 0;
  var size = 0;
  var end = 0;
  var wasCluster = false;
  var tracks = [];
  var lastTrackStart = 0;
  var lastTrackEnd = 0;
  var lastTrackNum = 0;
  var lastTrackCodec = 0;
  var keepTrack = 0;
  var lastGroupStart = 0;
  var lastGroupEnd = 0;
  var trackNum = 0;
  var wasBlock = false;

  var pushTrack = function() {
    if (lastTrackStart) {
      tracks.push({
        start: lastTrackStart,
        end: lastTrackEnd,
        codec: lastTrackCodec,
        number: lastTrackNum,
      });
    }
  };

  while (this.cur < this.data.length) {
    start = this.cur;
    element = this.readID();
    size = this.readSize();
    end = this.cur + size;

    switch (element) {
    case Remuxer.Segment:
      continue;
    case Remuxer.Tracks:
      continue;
    case Remuxer.TrackEntry:
      pushTrack();
      lastTrackStart = start;
      lastTrackEnd = end;
      continue;
    case Remuxer.TrackNumber:
      lastTrackNum = this.readUInt(size);
      continue;
    case Remuxer.CodecID:
      lastTrackCodec = this.readString(size);
      continue;
    case Remuxer.Cluster:
      if (wasCluster) continue;
      wasCluster = true;
      pushTrack();
      tracks.forEach(function(track) {
        if (!keepTrack && track.codec === this.keepCodec) {
          keepTrack = track.number;
        } else {
          this._void(track.start, track.end);
        }
      }, this);
      // Don't need to further process input without desired track.
      if (!keepTrack) return tracks;
      continue;
    case Remuxer.BlockGroup:
      lastGroupStart = start;
      lastGroupEnd = end;
      continue;
    case Remuxer.Block:
      trackNum = this.readSize();
      if (trackNum == keepTrack) {
        if (!wasBlock && this._hasLacing()) {
          // Don't need to further process track with lacing because
          // it's not supported.
          this.lacing = true;
          return tracks;
        }
        // XXX: Theoretically muxer might use lacing for some blocks,
        // but the only(?) Matroska lacing implementation is mkvmerge
        // and it always puts lacing bits.
        wasBlock = true;
      } else {
        this._void(lastGroupStart, lastGroupEnd);
      }
      this.cur = lastGroupEnd;
      continue;
    case Remuxer.SimpleBlock:
      trackNum = this.readSize();
      if (trackNum == keepTrack) {
        if (!wasBlock && this._hasLacing()) {
          this.lacing = true;
          return tracks;
        }
        wasBlock = true;
      } else {
        this._void(start, end);
      }
      break;
    }

    this.cur = end;
  }

  return tracks;
};

/**
 * Split passed multitrack WebM into separate VP9 and Opus WebMs.
 *
 * @param {Uint8Array} mixed - Input WebM
 * @return {{vp9: Uint8Array?, opus: Uint8Array?}} Video-only/audio-only WebMs.
 */
// TODO: Sequential remuxing.
Remuxer.split = function(videoBuffer) {
  // Create copy because we editing in-place.
  var audioBuffer = videoBuffer.slice();
  var videoRemuxer = new Remuxer(videoBuffer, Remuxer.CodecID_VP9);
  var audioRemuxer = null;
  var tracks = videoRemuxer.process();
  var hasVP9 = !!tracks.find(track => track.codec === Remuxer.CodecID_VP9);
  var hasOpus = !!tracks.find(track => track.codec === Remuxer.CodecID_Opus);

  if (!hasVP9 || videoRemuxer.lacing) {
    videoBuffer = null;
  }
  if (hasOpus) {
    audioRemuxer = new Remuxer(audioBuffer, Remuxer.CodecID_Opus);
    audioRemuxer.process();
  }
  if (!hasOpus || audioRemuxer.lacing) {
    // Garbage collect copy.
    audioBuffer = null;
  }

  return {vp9: videoBuffer, opus: audioBuffer};
};

function playMSE(video, url) {
  var mediaSource = new MediaSource();
  video.src = URL.createObjectURL(mediaSource);
  mediaSource.addEventListener("sourceopen", function() {
    fetch(url, {credentials: "same-origin"}).then(function(res) {
      return res.arrayBuffer();
    }).then(function(mixed) {
      var tracks = Remuxer.split(new Uint8Array(mixed));
      var videoSource = null;
      var audioSource = null;
      var videoUpdated = false;
      var audioUpdated = false;

      if (tracks.vp9) {
        videoSource = mediaSource.addSourceBuffer('video/webm; codecs="vp9"');
        videoSource.addEventListener("updateend", function () {
          videoUpdated = true;
          if (!tracks.opus || audioUpdated) {
            mediaSource.endOfStream();
          }
        });
        videoSource.appendBuffer(tracks.vp9);
      }

      if (tracks.opus) {
        audioSource = mediaSource.addSourceBuffer('video/webm; codecs="opus"');
        audioSource.addEventListener("updateend", function () {
          audioUpdated = true;
          if (!tracks.vp9 || videoUpdated) {
            mediaSource.endOfStream();
          }
        });
        audioSource.appendBuffer(tracks.opus);
      }

      if (!tracks.vp9 && !tracks.opus) {
        // This actually loads current page as video and it crashes
        // because mimetype text/html can't be played.
        video.src = "";
      }
    }).catch(function(err) {
      console.error(err);
    });
  });
}

function getDollchanAPI(cb) {
  function onmessage(e) {
    if (e.data === "de-answer-api-message" && e.ports) {
      window.removeEventListener("message", onmessage);
      clearTimeout(unlistenID);
      cb(e.ports[0]);
    }
  }

  window.addEventListener("message", onmessage);
  window.postMessage("de-request-api-message", "*");
  var unlistenID = setTimeout(function() {
    window.removeEventListener("message", onmessage);
  }, 5000);
}

function initDollchanAPI() {
  getDollchanAPI(function(port) {
    port.onmessage = function(e) {
      var msg = e.data;
      if (msg.name === "expandmedia" && /\.webm$/i.test(msg.data)) {
        var url = msg.data;
        var video = document.querySelector("video[src='" + url + "']");
        playMSE(video, url);
      }
    };
    port.postMessage({name: "registerapi", data: ["expandmedia"]});
  });
}

setTimeout(initDollchanAPI, 0);

// playMSE(document.querySelector("video"), "vic.webm");

// var fs = require("fs");
// var mixed = new Uint8Array(fs.readFileSync(process.argv[2]).buffer);
// var tracks = Remuxer.split(mixed);
// if (tracks.vp9) fs.writeFileSync("vp9.webm", Buffer.from(tracks.vp9.buffer));
// if (tracks.opus) fs.writeFileSync("opus.webm", Buffer.from(tracks.opus.buffer));
