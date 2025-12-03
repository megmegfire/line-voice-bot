module.exports = async (req, res) => {
  // CORSヘッダーを追加
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  // OPTIONSリクエスト対応
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // POSTリクエスト処理
  if (req.method === 'POST') {
    console.log('POST received');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    return res.status(200).json({ status: 'OK', method: 'POST' });
  }
  
  // GETリクエスト処理
  return res.status(200).json({ status: 'OK', method: 'GET' });
};
