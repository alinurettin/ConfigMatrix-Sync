document.getElementById('execForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('payloadInput').value;
  const out = document.getElementById('outputConsole');
  try {
    const parsed = JSON.parse(input);
    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    });
    const json = await res.json();
    out.textContent = JSON.stringify(json, null, 2);
  } catch (err) {
    out.textContent = 'Error: ' + err.message;
  }
});
