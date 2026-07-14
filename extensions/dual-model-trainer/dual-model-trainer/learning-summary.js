var fs = require('fs');
var path = require('path');
var os = require('os');

var STATE_DIR = process.env.OPENCLAW_STATE_DIR
  || path.join(process.env.OPENCLAW_HOME || process.env.USERPROFILE || process.env.HOME || os.homedir(), '.openclaw');
var LEARN_DIR = path.join(STATE_DIR, 'workspace', 'learning_data');
var LEARNING_DATA_PATH = path.join(LEARN_DIR, 'learning_log.jsonl');
var LEARNING_SUMMARY_PATH = path.join(LEARN_DIR, 'learning_summary.jsonl');
var SUMMARY_CACHE_PATH = path.join(LEARN_DIR, 'last_summary_index.txt');

function generateLearningSummary() {
  try {
    if (!fs.existsSync(LEARNING_DATA_PATH)) return {success:false,reason:'no_data'};
    var raw = fs.readFileSync(LEARNING_DATA_PATH, 'utf8');
    var lines = raw.split('\n').filter(function(l){return l.trim();});
    if (lines.length < 3) return {success:false,reason:'insufficient_data'};
    var lastIndex = 0;
    try { if (fs.existsSync(SUMMARY_CACHE_PATH)) lastIndex = parseInt(fs.readFileSync(SUMMARY_CACHE_PATH,'utf8').trim())||0; } catch(e){}
    var newLines = lines.slice(lastIndex);
    if (newLines.length < 3) return {success:false,reason:'no_new_data'};
    var summary = { time: new Date().toISOString(), count: newLines.length, sample: newLines.slice(0, 3) };
    fs.mkdirSync(LEARN_DIR, { recursive: true });
    fs.appendFileSync(LEARNING_SUMMARY_PATH, JSON.stringify(summary) + '\n', 'utf8');
    fs.writeFileSync(SUMMARY_CACHE_PATH, String(lines.length), 'utf8');
    return { success: true, count: newLines.length };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

module.exports = { generateLearningSummary };
