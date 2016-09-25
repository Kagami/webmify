// ==UserScript==
// @name        webmify
// @namespace   https://2ch.hk/webmify
// @description Allow to watch WebMs in Edge on some sites
// @downloadURL https://raw.githubusercontent.com/Kagami/webmify/master/webmify.user.js
// @updateURL   https://raw.githubusercontent.com/Kagami/webmify/master/webmify.user.js
// @include     https://2ch.hk/*
// @version     0.0.0
// @grant       none
// ==/UserScript==

function playMSE(video, url) {
  var mediaSource = new MediaSource();
  video.src = URL.createObjectURL(mediaSource);

  mediaSource.addEventListener("sourceopen", function() {
    var sourceBuffer = mediaSource.addSourceBuffer('video/webm; codecs="vp9"');
    fetch(url, {credentials: "same-origin"}).then(function(res) {

      function readVideoBytes() {
        return reader.read().then(function(result) {
          if (result.done) {
            if (offset) sourceBuffer.appendBuffer(buffer.slice(0, offset));
            mediaSource.endOfStream();
            return;
          }

          chunk = result.value;
          buffer.set(chunk.slice(0, bufferlen - offset), offset);
          if (chunk.length + offset >= bufferlen) {
            sourceBuffer.appendBuffer(buffer);
            chunk = chunk.slice(bufferlen - offset);
            while (chunk.length >= bufferlen) {
              sourceBuffer.appendBuffer(chunk.slice(0, bufferlen));
              chunk = chunk.slice(bufferlen);
            }
            buffer.set(chunk);
            offset = chunk.length;
          } else {
            offset += chunk.length;
          }

          return readVideoBytes();
        });
      }

      // XXX: Should be just `sourceBuffer.appendStream(res.body)` per
      // spec but that doesn't work.
      // XXX: For some reason we can't send less than 64K data per
      // single call of `appendBuffer` but Fetch API Reader returns 4K
      // per cycle.
      const bufferlen = 64 * 1024;
      var buffer = new Uint8Array(bufferlen);
      var offset = 0;
      var chunk;
      var reader = res.body.getReader();
      return readVideoBytes();

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
window.Stage("Show webm title", "webmtitle", window.Stage.DOMREADY, initObserver);
