const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

// 設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// Gemini初期化
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const client = new line.Client(config);

// 使用量管理（簡易版）
const usageTracker = {
  daily: new Map(),
  monthly: new Map()
};

// メイン処理
module.exports = async (req, res) => {
  try {
    // 署名検証
    if (!line.validateSignature(JSON.stringify(req.body), req.headers['x-line-signature'], config.channelSecret)) {
      return res.status(401).send('Unauthorized');
    }

    const events = req.body.events;
    res.status(200).json({ success: true });
    
    // 各イベントを非同期処理
    for (const event of events) {
      handleEventAsync(event);
    }
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Internal Server Error');
  }
};

// 非同期イベント処理
async function handleEventAsync(event) {
  if (event.type === 'message') {
    const userId = event.source.userId;
    
    if (event.message.type === 'text') {
      await handleTextMessage(event);
    } else if (event.message.type === 'audio') {
      // 使用量チェック
      const canProcess = checkUsageLimit(userId);
      
      if (canProcess.allowed) {
        await handleAudioMessage(event);
        incrementUsage(userId);
      } else {
        await handleUsageExceeded(event, canProcess);
      }
    }
  }
}

// 使用量制限チェック
function checkUsageLimit(userId) {
  const today = new Date().toISOString().split('T')[0];
  const thisMonth = today.substring(0, 7);
  
  const dailyUsage = usageTracker.daily.get(userId) || { date: today, count: 0 };
  const monthlyUsage = usageTracker.monthly.get(userId) || { month: thisMonth, count: 0 };
  
  // 日付リセット
  if (dailyUsage.date !== today) {
    dailyUsage.date = today;
    dailyUsage.count = 0;
  }
  
  if (monthlyUsage.month !== thisMonth) {
    monthlyUsage.month = thisMonth;
    monthlyUsage.count = 0;
  }
  
  const DAILY_LIMIT = 50;
  const MONTHLY_LIMIT = 1500;
  
  if (dailyUsage.count >= DAILY_LIMIT) {
    return { allowed: false, reason: 'daily', current: dailyUsage.count, limit: DAILY_LIMIT };
  }
  
  if (monthlyUsage.count >= MONTHLY_LIMIT) {
    return { allowed: false, reason: 'monthly', current: monthlyUsage.count, limit: MONTHLY_LIMIT };
  }
  
  return { 
    allowed: true, 
    dailyRemaining: DAILY_LIMIT - dailyUsage.count,
    monthlyRemaining: MONTHLY_LIMIT - monthlyUsage.count
  };
}

// 使用量増加
function incrementUsage(userId) {
  const today = new Date().toISOString().split('T')[0];
  const thisMonth = today.substring(0, 7);
  
  const dailyUsage = usageTracker.daily.get(userId) || { date: today, count: 0 };
  dailyUsage.count++;
  usageTracker.daily.set(userId, dailyUsage);
  
  const monthlyUsage = usageTracker.monthly.get(userId) || { month: thisMonth, count: 0 };
  monthlyUsage.count++;
  usageTracker.monthly.set(userId, monthlyUsage);
}

// 音声メッセージ処理
async function handleAudioMessage(event) {
  const messageId = event.message.id;
  const userId = event.source.userId;
  
  try {
    // 開始通知
    const usageInfo = checkUsageLimit(userId);
    await client.pushMessage(userId, {
      type: 'text',
      text: `🎤 音声を受信しました！\n🚀 Gemini 2.5 Proで処理中...\n\n📊 利用状況:\n今日: ${50 - usageInfo.dailyRemaining}/50回\n今月: ${1500 - usageInfo.monthlyRemaining}/1500回\n💰 料金: 無料`
    });

    // 音声データ取得
    console.log('Downloading audio...');
    const audioBuffer = await getAudioContent(messageId);
    
    // 進捗通知
    await client.pushMessage(userId, {
      type: 'text',
      text: '🔄 高精度AI処理中...\n⏱️ 1-2分程度お待ちください'
    });

    // Gemini Pro処理
    console.log('Processing with Gemini Pro...');
    const result = await processWithGeminiPro(audioBuffer);
    
    // 結果送信
    await client.pushMessage(userId, [
      {
        type: 'text',
        text: `✅ 処理完了！\n\n${result}`
      },
      {
        type: 'text',
        text: '💰 今回の料金: 無料（Gemini Pro無料枠利用）\n🎉 ご利用ありがとうございました！'
      }
    ]);

  } catch (error) {
    console.error('Audio processing error:', error);
    await client.pushMessage(userId, {
      type: 'text',
      text: '❌ 処理中にエラーが発生しました\n🔄 もう一度お試しください\n\nエラーが続く場合は管理者にお問い合わせください'
    });
  }
}

// Gemini Pro処理
async function processWithGeminiPro(audioBuffer) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-pro',
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      }
    });
    
    const audioBase64 = audioBuffer.toString('base64');
    
    const prompt = `
あなたは優秀な音声認識・要約アシスタントです。
以下の音声ファイルを正確に文字起こしし、重要なポイントを分かりやすく要約してください。

処理手順:
1. 音声を正確に文字起こしする
2. 重要なポイントを3-5項目で要約する
3. 話者の意図や感情も考慮する

出力形式:
📝 【文字起こし】
（音声の全文）

📋 【要約】
• ポイント1
• ポイント2
• ポイント3

💡 【補足】
（話者の意図や重要な背景情報があれば）
`;

    const result = await model.generateContent([
      {
        inlineData: {
          data: audioBase64,
          mimeType: 'audio/m4a'
        }
      },
      prompt
    ]);

    return result.response.text();
    
  } catch (error) {
    console.error('Gemini processing error:', error);
    throw new Error('音声処理でエラーが発生しました');
  }
}

// テキストメッセージ処理
async function handleTextMessage(event) {
  const text = event.message.text;
  const userId = event.source.userId;
  
  if (text === 'ヘルプ' || text === 'help' || text === '使用量') {
    const usageInfo = checkUsageLimit(userId);
    
    await client.pushMessage(userId, {
      type: 'text',
      text: `🤖 音声文字起こし・要約Bot\n(Gemini 2.5 Pro版)\n\n✨ 機能:\n• 高精度音声文字起こし\n• AI要約生成\n• 最大30分音声対応\n• 完全無料利用\n\n📊 利用状況:\n今日: ${50 - usageInfo.dailyRemaining}/50回\n今月: ${1500 - usageInfo.monthlyRemaining}/1500回\n\n💰 料金: 完全無料\n🚀 AI: Gemini 2.5 Pro最新版\n\n使い方: 音声メッセージを送信するだけ！`
    });
  } else {
    await client.pushMessage(userId, {
      type: 'text',
      text: '🎤 音声メッセージをお送りください！\n\n✨ Gemini 2.5 Pro最新AI\n📝 高精度文字起こし + 自動要約\n💰 完全無料（月1500回まで）\n⚡ 超高速処理\n\n「使用量」で利用状況を確認できます'
    });
  }
}

// 使用量超過処理
async function handleUsageExceeded(event, usageInfo) {
  const userId = event.source.userId;
  
  let message = '⚠️ 利用制限に達しました\n\n';
  
  if (usageInfo.reason === 'daily') {
    message += `🔄 本日の無料枠（50回）を使い切りました\n⏰ 明日の0時にリセットされます`;
  } else {
    message += `🔄 今月の無料枠（1500回）を使い切りました\n⏰ 来月1日にリセットされます`;
  }
  
  message += '\n\n💡 Gemini Proの無料枠は業界最大級です！\nしばらくお待ちください。';
  
  await client.pushMessage(userId, { type: 'text', text: message });
}

// 音声データ取得
async function getAudioContent(messageId) {
  try {
    const response = await axios.get(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: { 'Authorization': `Bearer ${config.channelAccessToken}` },
        responseType: 'arraybuffer',
        timeout: 120000
      }
    );
    
    return Buffer.from(response.data);
  } catch (error) {
    console.error('Audio download error:', error);
    throw new Error('音声データの取得に失敗しました');
  }
}