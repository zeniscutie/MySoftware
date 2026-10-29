'use strict';

/**
 * Splits a shell command line into simple commands, each a list of words.
 * Understands quotes, backslash escapes and the separators && || ; | & ( )
 * newlines, backticks and $( ). It is not a full shell parser; it is enough
 * for hooks to recognise commands like `git commit --no-verify` inside
 * `cd theme && shopify theme push --live`.
 */
function splitCommands(line) {
  const commands = [];
  let words = [];
  let word = '';
  let inWord = false;
  let quote = null;
  const text = String(line || '');

  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && i + 1 < text.length && '"\\$`'.includes(text[i + 1])) word += text[++i];
      else word += ch;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (ch === '\\' && i + 1 < text.length) {
      if (text[i + 1] !== '\n') {
        word += text[i + 1];
        inWord = true;
      }
      i++;
    } else if (ch === '$' && text[i + 1] === '(') {
      endCommand();
      i++;
    } else if (';&|()\n`'.includes(ch)) {
      endCommand();
    } else if (ch === ' ' || ch === '\t' || ch === '\r') {
      endWord();
    } else {
      word += ch;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}

/** True when word is name or a path ending in name (e.g. ./node_modules/.bin/shopify). */
function isProgram(word, name) {
  const base = String(word).split(/[\\/]/).pop().toLowerCase();
  return base === name || base === `${name}.cmd` || base === `${name}.exe`;
}

module.exports = { splitCommands, isProgram };
