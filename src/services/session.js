const sessions = {};

function getSession(chatId) {
  return sessions[chatId] || null;
}

function setSession(chatId, data) {
  sessions[chatId] = {
    ...data,
    updatedAt: Date.now(), // always set on every call
  };
}

function clearSession(chatId) {
  delete sessions[chatId];
}

// Auto-expire sessions after 30 minutes of inactivity
setInterval(() => {
  const now = Date.now();
  for (const id of Object.keys(sessions)) {
    if (now - sessions[id].updatedAt > 30 * 60 * 1000) delete sessions[id];
  }
}, 5 * 60 * 1000);

module.exports = { getSession, setSession, clearSession };
