const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const historyCsvPath = path.join(__dirname, 'history.csv');

ensureCsvFile();
const submissions = loadCsvSubmissions();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/upload', (req, res) => {
  const textContent = (req.body.text || '').trim();
  if (!textContent) {
    return res.status(400).send(
      renderPage(
        'Upload error',
        `<div class="card"><h1>Upload error</h1><p class="notice">Text cannot be empty.</p><div class="footer-links"><a class="button-link" href="/">Go back</a></div></div>`
      )
    );
  }

  const now = new Date();
  const receivedDate = now.toISOString().slice(0, 10);
  const receivedTime = now.toISOString().slice(11, 19);
  const senderUsername = (req.body.senderUsername || '').trim();
  const sourcePage = (req.body.source || '').trim();
  const isChatSource = sourcePage === 'chat';

  const submission = { textContent, receivedTime, receivedDate, senderUsername };
  submissions.push(submission);

  try {
    appendToCsv(submission);
  } catch (error) {
    console.error('Failed to write history.csv:', error);
    return res.status(500).send(
      renderPage(
        'Server error',
        `<div class="card"><h1>Server error</h1><p class="notice">Unable to save your text right now. Please try again later.</p><div class="footer-links"><a class="button-link" href="/">Go back</a></div></div>`
      )
    );
  }

  const extraChatLink = isChatSource ? '<a class="button-link" href="/chat">Back to chat</a>' : '';
  res.send(
    renderPage(
      'Submission received',
      `<div class="card"><h1>Thank you!</h1><p>Your text was received successfully.</p><div class="footer-links"><a class="button-link" href="/">Upload more text</a><a class="button-link" href="/submissions">View submissions</a>${extraChatLink}</div></div>`
    )
  );
});

app.get('/chat', (req, res) => {
  const recentSubmissions = loadCsvSubmissions().slice(-8);
  const chatItems = recentSubmissions.length
    ? recentSubmissions
        .map((item, index) => {
          const sender = item.senderUsername ? escapeHtml(item.senderUsername) : 'Anonymous';
          const message = escapeHtml(item.textContent);
          const bubbleClass = index % 2 === 0 ? 'chat-message--sender' : 'chat-message--user';
          return `
            <div class="chat-message ${bubbleClass}">
              <div class="chat-message__body">${message}</div>
              <div class="chat-message__meta">${sender} · ${escapeHtml(item.receivedDate)} ${escapeHtml(item.receivedTime)}</div>
            </div>`;
        })
        .join('')
    : '<div class="chat-empty"><p>Your chat window is empty. Send a message to start the conversation.</p></div>';

  res.send(
    renderPage(
      'Chat interface',
      `<div class="card chat-card">
        <div class="brand">
          <span class="brand__mark">💬</span>
          <div>
            <h1>Chat interface</h1>
            <p class="meta">A chat-style view for submitting text and seeing recent entries as messages.</p>
          </div>
        </div>

        <div class="chat-window">${chatItems}</div>

        <form class="chat-form" method="POST" action="/upload">
          <input type="hidden" name="source" value="chat" />
          <div class="form-row">
            <label for="senderUsername">Username</label>
            <input id="senderUsername" name="senderUsername" type="text" placeholder="Your username (optional)" autocomplete="username" />
          </div>
          <div class="form-row">
            <label for="text">Message</label>
            <textarea id="text" name="text" placeholder="Type your message here..." required></textarea>
          </div>
          <div class="chat-actions">
            <button type="submit">Send message</button>
          </div>
        </form>

        <div class="footer-links">
          <a class="button-link" href="/">Back to upload page</a>
          <a class="button-link" href="/submissions">View submissions</a>
        </div>
      </div>`
    )
  );
});

app.get('/submissions', (req, res) => {
  const csvSubmissions = loadCsvSubmissions();
  const rows = csvSubmissions
    .map(
      (item, index) =>
        `<tr><td>${index + 1}</td><td>${escapeHtml(item.senderUsername)}</td><td><pre>${escapeHtml(item.textContent)}</pre></td><td>${escapeHtml(item.receivedDate)}</td><td>${escapeHtml(item.receivedTime)}</td></tr>`
    )
    .join('');

  res.send(
    renderPage(
      'Received submissions',
      `<div class="card"><div class="brand"><span class="brand__mark">📥</span><div><h1>Received submissions</h1><p class="meta">Browse all saved text submissions from the form.</p></div></div><div class="table-wrapper"><table><thead><tr><th>#</th><th>Sender Username</th><th>Text</th><th>Date</th><th>Time</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No submissions yet.</td></tr>'}</tbody></table></div><div class="footer-links"><a class="button-link" href="/">Back to upload page</a></div></div>`
    )
  );
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

function ensureCsvFile() {
  if (!fs.existsSync(historyCsvPath)) {
    fs.writeFileSync(historyCsvPath, 'senderUsername,textContent,receivedDate,receivedTime\n', 'utf8');
  } else {
    migrateCsvToCurrentFormat();
  }
}

function migrateCsvToCurrentFormat() {
  const content = fs.readFileSync(historyCsvPath, 'utf8');
  const rows = splitCsvRows(content);
  if (rows.length === 0) {
    return;
  }

  const header = parseCsvLine(rows[0]);
  const currentHeader = ['senderUsername', 'textContent', 'receivedDate', 'receivedTime'];
  const oldHeader = ['textContent', 'receivedTime', 'receivedDate', 'senderUsername'];
  const legacyHeader = ['text', 'createdAt'];
  const isCurrentFormat = arraysEqual(header, currentHeader);
  const isOldFormat = arraysEqual(header, oldHeader);
  const isLegacyFormat = arraysEqual(header, legacyHeader);

  if (isCurrentFormat) {
    return;
  }

  const migratedRows = rows
    .slice(1)
    .map((line) => {
      const values = parseCsvLine(line);
      if (values.length === 0 || (values.length === 1 && values[0] === '')) {
        return null;
      }

      if (isOldFormat) {
        const [textContent, receivedTime, receivedDate, senderUsername] = values;
        return `${escapeCsv(senderUsername)},${escapeCsv(textContent)},${escapeCsv(receivedDate)},${escapeCsv(receivedTime)}`;
      }

      if (isLegacyFormat) {
        const [text, createdAt] = values;
        const date = createdAt ? new Date(createdAt) : null;
        const receivedDate = date ? date.toISOString().slice(0, 10) : '';
        const receivedTime = date ? date.toISOString().slice(11, 19) : '';
        return `${escapeCsv('')},${escapeCsv(text)},${escapeCsv(receivedDate)},${escapeCsv(receivedTime)}`;
      }

      return null;
    })
    .filter((line) => line !== null)
    .join('\n');

  fs.writeFileSync(historyCsvPath, currentHeader.join(',') + '\n' + (migratedRows ? migratedRows + '\n' : ''), 'utf8');
}

function loadCsvSubmissions() {
  const content = fs.readFileSync(historyCsvPath, 'utf8');
  const rows = splitCsvRows(content);

  if (rows.length <= 1) {
    return [];
  }

  const header = parseCsvLine(rows[0]);
  const currentHeader = ['senderUsername', 'textContent', 'receivedDate', 'receivedTime'];
  const oldHeader = ['textContent', 'receivedTime', 'receivedDate', 'senderUsername'];
  const legacyHeader = ['text', 'createdAt'];
  const isCurrentFormat = arraysEqual(header, currentHeader);
  const isOldFormat = arraysEqual(header, oldHeader);
  const isLegacyFormat = arraysEqual(header, legacyHeader);

  return rows
    .slice(1)
    .map((line) => {
      const values = parseCsvLine(line);
      if (values.length === 0 || (values.length === 1 && values[0] === '')) {
        return null;
      }

      if (isCurrentFormat) {
        const [senderUsername, textContent, receivedDate, receivedTime] = values;
        return { senderUsername, textContent, receivedDate, receivedTime };
      }

      if (isOldFormat) {
        const [textContent, receivedTime, receivedDate, senderUsername] = values;
        return { senderUsername, textContent, receivedDate, receivedTime };
      }

      if (isLegacyFormat) {
        const [text, createdAt] = values;
        const [receivedDate, receivedTime] = createdAt.split('T');
        return {
          senderUsername: '',
          textContent: text,
          receivedDate: receivedDate || '',
          receivedTime: receivedTime ? receivedTime.replace(/Z$/, '') : ''
        };
      }

      const [senderUsername, textContent, receivedDate, receivedTime] = values.concat(['', '', '', '']).slice(0, 4);
      return { senderUsername, textContent, receivedDate, receivedTime };
    })
    .filter(Boolean);
}

function splitCsvRows(content) {
  const rows = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\n') {
        rows.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.trim() !== '') {
    rows.push(current);
  }

  return rows;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === ',') {
      result.push(current);
      current = '';
    } else if (char === '"') {
      inQuotes = true;
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function appendToCsv(submission) {
  const line = `${escapeCsv(submission.senderUsername)},${escapeCsv(submission.textContent)},${escapeCsv(submission.receivedDate)},${escapeCsv(submission.receivedTime)}\n`;
  fs.appendFileSync(historyCsvPath, line, 'utf8');
}

function escapeCsv(value) {
  const stringValue = String(value);
  const needsQuotes = /[",\n\r]/.test(stringValue);
  const escaped = stringValue.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main class="page-shell">
      ${bodyHtml}
    </main>
  </body>
</html>`;
}
