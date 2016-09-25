## webmify

Fix sites to make WebMs playable in Edge. Only VP9 without audio (single video track) works for a moment.

### Supported sites

* 2ch.hk

### Install

* Install Edge 14+ (Windows 10 Anniversary Update or Insider Build)
* Set "Always on" option for VP9 in about:flags
* Restart Edge
* Install [Tampermonkey](https://www.microsoft.com/en-us/store/p/tampermonkey/9nblggh5162s)
* Install [webmify.user.js](webmify.user.js)

### Technical details

Latest Edge has support for VP9/Opus MSE tracks but not for a common WebM files. This script patches site logic and loads WebMs via MSE API so they can be played in Edge. Unfortunately Edge doesn't support SourceBuffer with VP9 and Opus tracks muxed together so currently only WebMs with single VP9 track work.

### License

[CC0.](COPYING)
