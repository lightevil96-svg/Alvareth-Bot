import test from 'node:test'
import assert from 'node:assert/strict'
import { extractXMedia, parseXStatusUrl } from '../lib/scrape/twitter.js'
import { readFile } from 'node:fs/promises'

test('X status URL parser removes tracking parameters and extracts the status ID', () => {
  assert.deepEqual(
    parseXStatusUrl('https://x.com/TheOtakuSauna/status/2117840759772659847?a=tFuARDA66HOZZ8yjX00&s=19'),
    {
      id: '2117840759772659847',
      screenName: 'TheOtakuSauna',
      url: 'https://x.com/TheOtakuSauna/status/2117840759772659847'
    }
  )
  assert.equal(parseXStatusUrl('https://twitter.com/example/status/123?ref=share').id, '123')
})

test('X status URL parser rejects unsupported hosts and malformed status paths', () => {
  assert.throws(() => parseXStatusUrl('https://x.com.evil.example/user/status/123'), /x.com|twitter.com/i)
  assert.throws(() => parseXStatusUrl('https://x.com/user/status/not-a-number'), /ID postingan/i)
  assert.throws(() => parseXStatusUrl('not a URL'), /tidak valid/i)
})

test('FxTwitter v2 media.all preserves photo and video types and selects the best MP4 variant', () => {
  const media = extractXMedia({
    code: 200,
    status: {
      id: '123',
      media: {
        all: [
          { type: 'photo', url: 'https://pbs.twimg.com/media/photo-1.jpg?name=large' },
          {
            type: 'video',
            url: 'https://video.twimg.com/ext_tw_video/123/pu/pl/master.m3u8',
            variants: [
              { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/ext_tw_video/123/pu/pl/master.m3u8' },
              { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/video-720.mp4' },
              { content_type: 'video/mp4', bitrate: 256000, url: 'https://video.twimg.com/ext_tw_video/123/pu/vid/480x854/video-480.mp4' }
            ]
          }
        ]
      }
    }
  })
  assert.deepEqual(media, [
    { type: 'image', url: 'https://pbs.twimg.com/media/photo-1.jpg?name=large' },
    { type: 'video', url: 'https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/video-720.mp4' }
  ])
})

test('FxTwitter legacy response supports photo-only posts and mixed media', () => {
  const photosOnly = extractXMedia({
    tweet: {
      media: {
        photos: [{ url: 'https://pbs.twimg.com/media/only-photo.jpg' }]
      }
    }
  })
  assert.deepEqual(photosOnly, [
    { type: 'image', url: 'https://pbs.twimg.com/media/only-photo.jpg' }
  ])

  const mixed = extractXMedia({
    tweet: {
      media: {
        photos: [{ url: 'https://pbs.twimg.com/media/photo.jpg' }],
        videos: [{ type: 'video', url: 'https://video.twimg.com/ext_tw_video/123/video.mp4' }]
      }
    }
  })
  assert.deepEqual(mixed.map(item => item.type), ['image', 'video'])
})

test('VXTwitter media_extended returns photo-only posts as images', () => {
  const media = extractXMedia({
    media_extended: [
      {
        type: 'image',
        url: 'https://pbs.twimg.com/media/vx-photo.jpg',
        thumbnail_url: 'https://pbs.twimg.com/media/vx-photo.jpg'
      }
    ],
    mediaURLs: ['https://pbs.twimg.com/media/vx-photo.jpg']
  })
  assert.deepEqual(media, [
    { type: 'image', url: 'https://pbs.twimg.com/media/vx-photo.jpg' }
  ])
})

test('VXTwitter mediaURLs fallback infers media type from X CDN host', () => {
  const media = extractXMedia({
    mediaURLs: [
      'https://pbs.twimg.com/media/photo.jpg',
      'https://video.twimg.com/tweet_video/clip.mp4'
    ]
  })
  assert.deepEqual(media.map(item => item.type), ['image', 'video'])
})

test('X media parser rejects arbitrary external URLs', () => {
  assert.deepEqual(extractXMedia({
    tweet: { media: { photos: [{ url: 'https://evil.example/photo.jpg' }] } }
  }), [])
})

test('Downloader plugins use the new Instagram extractor and X image/video send branches', async () => {
  const [instagram, twitter] = await Promise.all([
    readFile(new URL('../plugins/downloader/ig.js', import.meta.url), 'utf8'),
    readFile(new URL('../plugins/downloader/twitter.js', import.meta.url), 'utf8')
  ])
  assert.match(instagram, /downloadInstagramMediaYtDlp/)
  assert.match(twitter, /extractXMedia/)
  assert.match(twitter, /image:\s*media\.buffer/)
  assert.match(twitter, /video:\s*media\.buffer/)
  assert.match(twitter, /savetwitter\.net\/api\/ajaxSearch/)
})
