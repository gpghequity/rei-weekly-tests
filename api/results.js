// Simple API to return latest test results
// In production, this would read from Google Sheets

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Return sample data structure
  // In production, fetch from Google Sheets via googleapis client
  res.json({
    latest: new Date().toISOString().split('T')[0],
    passed: 5,
    failed: 0,
    total: 5,
    rate: 100,
    results: [
      {
        timestamp: new Date().toISOString(),
        passed: 5,
        failed: 0,
        total: 5,
        properties: 'Commercial ✅ | Residential ✅ | MHP ✅ | Storage ✅ | Land ✅'
      }
    ],
    message: 'GitHub Actions workflow posts results here after each Monday 1AM run'
  });
}
