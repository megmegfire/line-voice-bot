const line = require('@line/bot-sdk');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

// Cloudinary設定
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 使用状況トラッキング
const usageTracking = {
  daily: 0,
  total: 0,
  lastReset: new Date().toDateString(),
  audioCount: 0
};

// ユーザーの音声ファイル情報を一時保存
const userAudioCache = {};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(200).send('LINE Audio Download Bot is running! 🎵');
  }

  try {
    const events = req.body.events;
    
    if (!events || events.length === 0) {
      return res.status(200).json({ message: 'No events' });
    }

    await Promise.all(events.map(async (event) => {
      if (event.type === 'message') {
        const userId = event.source.userId;
        
        // 使用状況リセット
        const today = new Date().toDateString();
        if (usageTracking.lastReset !== today) {
          usageTracking.daily = 0;
          usageTracking.lastReset = today;
        }

        // テキストメッセージ処理
        if (event.message.type === 'text') {
          const text = event.message.text.trim();
          
          if (text === 'ヘルプ' || text === 'help') {
            await client.replyMessage({
              replyToken: event.replyToken,
              messages: [{
                type: 'text',
                text: '🎵 音声ダウンロードBot\n\n' +
                      '【使い方】\n' +
                      '1. 音声メッセージを送信\n' +
                      '2. 速度を選択（0.5〜2.0倍速）\n' +
                      '3. ダウンロードリンクが届く\n\n' +
                      '【対応形式】\n' +
                      '・m4a (LINE音声)\n' +
                      '・保存期限なし\n' +
                      '・速度変更可能\n\n' +
                      '【コマンド】\n' +
                      '📊 利用状況 → 今日/合計の利用状況\n' +
                      '❓ ヘルプ → この画面'
              }]
            });
            return;
          }

          if (text === '利用状況') {
            await client.replyMessage({
              replyToken: event.replyToken,
              messages: [{
                type: 'text',
                text: `📊 利用状況\n\n` +
                      `今日: ${usageTracking.daily}回\n` +
                      `合計: ${usageTracking.total}回\n` +
                      `保存音声数: ${usageTracking.audioCount}件`
              }]
            });
            return;
          }

          // 速度選択の処理
          if (['0.5', '1.0', '1.5', '2.0'].includes(text)) {
            const speed = parseFloat(text);
            const cachedAudio = userAudioCache[userId];
            
            if (!cachedAudio) {
              await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                  type: 'text',
                  text: '⚠️ 音声ファイルが見つかりません。\n先に音声メッセージを送信してください。'
                }]
              });
              return;
            }

            // 処理中メッセージ
            await client.replyMessage({
              replyToken: event.replyToken,
              messages: [{
                type: 'text',
                text: `🎵 ${speed}倍速で処理中です...\n少々お待ちください`
              }]
            });

            try {
              const publicId = cachedAudio.publicId;
              const duration = cachedAudio.duration;
              
              // Cloudinaryで速度変更されたURLを生成
              let speedUrl;
              if (speed === 1.0) {
                // 通常速度の場合は元のURL
                speedUrl = cachedAudio.originalUrl;
              } else {
                // 速度変更: e_accelerate:X (Xは速度の逆数 × 100)
                const accelerateValue = Math.round((1 / speed) * 100);
                speedUrl = cloudinary.url(publicId, {
                  resource_type: 'video',
                  effect: `accelerate:${accelerateValue}`,
                  format: 'm4a'
                });
              }

              const adjustedDuration = Math.floor(duration / speed);
              const speedLabel = speed === 0.5 ? '🐢 ゆっくり' :
                                speed === 1.0 ? '📢 通常' :
                                speed === 1.5 ? '🚀 速い' :
                                '⚡ 超速';

              // 結果を送信
              await client.pushMessage({
                to: userId,
                messages: [{
                  type: 'text',
                  text: `✅ ${speedLabel} (${speed}倍速) 準備完了!\n\n` +
                        `【ダウンロードリンク】\n${speedUrl}\n\n` +
                        `元の長さ: ${Math.floor(duration)}秒\n` +
                        `変換後: 約${adjustedDuration}秒\n` +
                        `形式: m4a\n\n` +
                        `💡 上のリンクをタップしてダウンロードできます！\n\n` +
                        `別の速度で試す場合は、もう一度速度を選択してください。`
                }]
              });

            } catch (error) {
              console.error('速度変更エラー:', error);
              await client.pushMessage({
                to: userId,
                messages: [{
                  type: 'text',
                  text: `❌ エラー: ${error.message}\n\n再度お試しください`
                }]
              });
            }
            return;
          }
        }

        // 音声メッセージ処理
        if (event.message.type === 'audio') {
          usageTracking.daily++;
          usageTracking.total++;
          usageTracking.audioCount++;

          // 処理中メッセージ
          await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
              type: 'text',
              text: '🎵 音声をアップロード中です...\n少々お待ちください'
            }]
          });

          try {
            const messageId = event.message.id;
            const duration = (event.message.duration || 0) / 1000; // ミリ秒→秒
            
            // 音声ファイルをダウンロード
            const audioResponse = await axios.get(
              `https://api-data.line.me/v2/bot/message/${messageId}/content`,
              {
                headers: {
                  Authorization: `Bearer ${config.channelAccessToken}`
                },
                responseType: 'arraybuffer'
              }
            );

            const audioBuffer = Buffer.from(audioResponse.data);
            
            // Cloudinaryにアップロード
            const uploadResult = await new Promise((resolve, reject) => {
              const uploadStream = cloudinary.uploader.upload_stream(
                {
                  resource_type: 'video',
                  format: 'm4a',
                  public_id: `line_audio_${messageId}`,
                  folder: 'line_audio'
                },
                (error, result) => {
                  if (error) reject(error);
                  else resolve(result);
                }
              );
              uploadStream.end(audioBuffer);
            });

            const audioUrl = uploadResult.secure_url;
            const publicId = uploadResult.public_id;

            // ユーザーの音声情報をキャッシュ
            userAudioCache[userId] = {
              publicId: publicId,
              originalUrl: audioUrl,
              duration: duration,
              timestamp: Date.now()
            };

            // 速度選択ボタンを送信
            await client.pushMessage({
              to: userId,
              messages: [
                {
                  type: 'text',
                  text: `✅ 音声アップロード完了!\n\n` +
                        `長さ: ${Math.floor(duration)}秒\n` +
                        `形式: m4a\n\n` +
                        `希望の再生速度を選択してください:`
                },
                {
                  type: 'template',
                  altText: '速度を選択してください',
                  template: {
                    type: 'buttons',
                    text: '再生速度を選択',
                    actions: [
                      {
                        type: 'message',
                        label: '🐢 0.5倍速 (ゆっくり)',
                        text: '0.5'
                      },
                      {
                        type: 'message',
                        label: '📢 1.0倍速 (通常)',
                        text: '1.0'
                      },
                      {
                        type: 'message',
                        label: '🚀 1.5倍速 (速い)',
                        text: '1.5'
                      },
                      {
                        type: 'message',
                        label: '⚡ 2.0倍速 (超速)',
                        text: '2.0'
                      }
                    ]
                  }
                }
              ]
            });

          } catch (audioError) {
            console.error('音声処理エラー:', audioError);
            await client.pushMessage({
              to: userId,
              messages: [{
                type: 'text',
                text: `❌ エラー: ${audioError.message}\n\n再度お試しください`
              }]
            });
          }
        }
      }
    }));

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Webhook Error:', err);
    return res.status(200).json({ error: err.message });
  }
};
