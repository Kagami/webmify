// ==UserScript==
// @name        webmify
// @namespace   https://2ch.hk/webmify
// @description Allow to watch WebMs in Edge on some sites
// @downloadURL https://raw.githubusercontent.com/Kagami/webmify/master/webmify.user.js
// @updateURL   https://raw.githubusercontent.com/Kagami/webmify/master/webmify.user.js
// @include     https://2ch.hk/*
// @version     0.0.2
// @grant       none
// ==/UserScript==

function Remuxer(data) {
  this.data = data;
  this.cur = 0;
}

Remuxer.Void = 0xec;
Remuxer.Segment = 0x18538067;
Remuxer.Tracks = 0x1654ae6b;
Remuxer.TrackEntry = 0xae;
Remuxer.TrackNumber = 0xd7;
Remuxer.CodecID = 0x86;
Remuxer.CodecID_VP9 = "V_VP9";
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

  while (this.cur <= this.data.length) {
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
      break;
    case Remuxer.CodecID:
      lastTrackCodec = this.readString(size);
      break;
    case Remuxer.Cluster:
      if (wasCluster) continue;
      wasCluster = true;
      // TODO: Throw if no (VP9) track.
      pushTrack();
      tracks.forEach(function(track) {
        if (!keepTrack && track.codec === Remuxer.CodecID_VP9) {
          keepTrack = track.number;
        } else {
          this._void(track.start, track.end);
        }
      }, this);
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
}

// TODO: Sequential remuxing.
// TODO: Extract audio to separate buffer.
Remuxer.filterVP9 = function(data) {
  var remuxer = new Remuxer(data);
  remuxer.process();
}

function playMSE(video, url) {
  var mediaSource = new MediaSource();
  video.src = URL.createObjectURL(mediaSource);
  mediaSource.addEventListener("sourceopen", function() {
    var sourceBuffer = mediaSource.addSourceBuffer('video/webm; codecs="vp9"');
    fetch(url, {credentials: "same-origin"}).then(function(res) {
      return res.arrayBuffer();
    }).then(function(buffer) {
      buffer = new Uint8Array(buffer);
      Remuxer.filterVP9(buffer);
      sourceBuffer.addEventListener("updateend", function () {
        mediaSource.endOfStream();
      });
      sourceBuffer.appendBuffer(buffer);
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
        // TODO: Cancel Fetch request on close.
        playMSE(video, url);
      });
    });
  });
  observer.observe(container, {childList: true});
}

// Makaba API. We need to run _after_ "screenexpand" routine.
// It runs on DOMContentLoaded but Greasemonkey injects callback earlier.
window.Stage("Edge WebM fix", "webmify", window.Stage.DOMREADY, initObserver);

// playMSE(document.querySelector("video"), "va5.webm");

// var fs = require("fs");
// var data = fs.readFileSync("va5.webm");
// Remuxer.filterVP9(data);
// fs.writeFileSync("va5-fixed.webm", data);
