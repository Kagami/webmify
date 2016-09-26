// ==UserScript==
// @name        webmify
// @namespace   https://2ch.hk/webmify
// @description Allow to watch WebMs in Edge on some sites
// @downloadURL https://raw.githubusercontent.com/Kagami/webmify/master/webmify.user.js
// @updateURL   https://raw.githubusercontent.com/Kagami/webmify/master/webmify.user.js
// @include     https://2ch.hk/*
// @version     0.0.3
// @grant       none
// ==/UserScript==

function Remuxer(data, keepCodec) {
  this.data = data;
  this.keepCodec = keepCodec;
  this.cur = 0;
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
}

Remuxer.prototype.readSize = function() {
  return this._readCoded(false);
}

Remuxer.prototype.readUInt = function(size) {
  var n = 0;
  while (size--) {
    n = (n << 8) | this.data[this.cur++];
  }
  return n;
}

Remuxer.prototype.readString = function(size) {
  // TODO: Remove zero-padding per spec?
  var s = "";
  while (size--) {
    s += String.fromCharCode(this.data[this.cur++]);
  }
  return s;
}

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
}

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
}

Remuxer.prototype._void = function(start, end) {
  var savedCur = this.cur;
  this.cur = start;
  this.writeID(Remuxer.Void);
  this.writeSize(end - this.cur);
  this.cur = savedCur;
}

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
  var savedCur = 0;
  var trackNum = 0;

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
      if (!keepTrack) return tracks;
      continue;
    case Remuxer.BlockGroup:
      // XXX: Seems like Edge doesn't support Block groups:
      // >MEDIA12598: Independent composition is disabled for video
      // >rendering. This can negatively impact performance.
      // Some WebMs contain BlockGroup Element at the very end so we
      // just skip it.
      this._void(start, end);
      break;
    case Remuxer.SimpleBlock:
      savedCur = this.cur;
      trackNum = this.readSize();
      if (trackNum != keepTrack) {
        this._void(start, end);
      }
      this.cur = savedCur;
      break;
    }

    this.cur += size;
  }

  return tracks;
}

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

  if (!hasVP9) {
    videoBuffer = null;
  }
  if (hasOpus) {
    audioRemuxer = new Remuxer(audioBuffer, Remuxer.CodecID_Opus);
    audioRemuxer.process();
  } else {
    // Garbage collect copy.
    audioBuffer = null;
  }

  return {vp9: videoBuffer, opus: audioBuffer};
}

function playMSE(video, url) {
  var mediaSource = new MediaSource();
  video.src = URL.createObjectURL(mediaSource);
  mediaSource.addEventListener("sourceopen", function() {
    // Not possible to abort fetch request (when user loads new WebM)
    // right now: <https://github.com/whatwg/fetch/issues/27>.
    // It shouldn't cause issues except additional traffic/cpu load
    // because Makaba creates(?) new <video> element each time.
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
        // XXX: This actually loads current page as video and it crashes
        // because mimetype text/html can't be played. Seems like there
        // is no other way to unload video?
        video.src = "";
      }
    }).catch(function(err) {
      console.error(err);
    });
  });
}

function initObserver() {
  var container = document.getElementById("fullscreen-container");
  if (!container) return;
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      Array.prototype.filter.call(mutation.addedNodes, function(node) {
        return node.tagName === "VIDEO";
      }).forEach(function(video) {
        var url = video.querySelector("source").src;
        playMSE(video, url);
      });
    });
  });
  observer.observe(container, {childList: true});
}

// Makaba API. We need to run _after_ "screenexpand" routine.
// It runs on DOMContentLoaded but Greasemonkey injects callback earlier.
window.Stage("Edge WebM fix", "webmify", window.Stage.DOMREADY, initObserver);

// playMSE(document.querySelector("video"), "va7.webm");

// var fs = require("fs");
// var mixed = new Uint8Array(fs.readFileSync("vp9+vorbis.webm").buffer);
// var tracks = Remuxer.split(mixed);
// if (tracks.vp9) fs.writeFileSync("vp9.webm", Buffer.from(tracks.vp9.buffer));
// if (tracks.opus) fs.writeFileSync("opus.webm", Buffer.from(tracks.opus.buffer));
