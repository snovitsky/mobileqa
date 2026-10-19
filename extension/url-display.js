// Unicode предназначен только для чтения. Проверки доступа и сравнение адресов
// должны использовать исходный ASCII URL/pattern, а не этот результат.
const MAX_INTEGER = 0x7fffffff;

function decodeLabel(label) {
 if (!/^xn--/i.test(label)) return label;
 const encoded = label.slice(4);
 if (!encoded || label.length > 63 || !/^[a-z0-9-]+$/i.test(encoded)) throw new Error('Invalid label');
 const output = [];
 const delimiter = encoded.lastIndexOf('-');
 let index = delimiter < 0 ? 0 : delimiter + 1;
 if (delimiter >= 0) for (const character of encoded.slice(0, delimiter)) output.push(character.charCodeAt(0));
 let n = 128, accumulator = 0, bias = 72;
 while (index < encoded.length) {
  const previous = accumulator;
  let weight = 1;
  for (let k = 36; ; k += 36) {
   if (index >= encoded.length) throw new Error('Incomplete label');
   const code = encoded.charCodeAt(index++);
   const digit = code >= 48 && code <= 57 ? code - 22
    : code >= 65 && code <= 90 ? code - 65 : code >= 97 && code <= 122 ? code - 97 : 36;
   if (digit >= 36 || digit > Math.floor((MAX_INTEGER - accumulator) / weight)) throw new Error('Label overflow');
   accumulator += digit * weight;
   const threshold = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
   if (digit < threshold) break;
   if (weight > Math.floor(MAX_INTEGER / (36 - threshold))) throw new Error('Label overflow');
   weight *= 36 - threshold;
  }
  const count = output.length + 1;
  let delta = Math.floor((accumulator - previous) / (previous === 0 ? 700 : 2));
  delta += Math.floor(delta / count);
  let k = 0;
  while (delta > 455) { delta = Math.floor(delta / 35); k += 36; }
  bias = k + Math.floor(36 * delta / (delta + 38));
  const increment = Math.floor(accumulator / count);
  if (increment > 0x10ffff - n) throw new Error('Invalid code point');
  n += increment;
  if (n >= 0xd800 && n <= 0xdfff) throw new Error('Invalid code point');
  accumulator %= count;
  output.splice(accumulator++, 0, n);
 }
 const decoded = String.fromCodePoint(...output);
 if (!output.some(code => code >= 128) || /[\u0000-\u0020\u007f-\u009f.\u3002\uff0e\uff61/:@\\?#]/u.test(decoded)) throw new Error('Invalid decoded label');
 return decoded;
}

export function displayAddress(input) {
 if (typeof input !== 'string') return input;
 const match = /^(https?:\/\/)([^/?#]+)([\s\S]*)$/i.exec(input);
 if (!match || match[2].includes('@') || match[2].startsWith('[')) return input;
 const authority = /^(.*?)(:\d+)?$/.exec(match[2]);
 const host = authority[1], port = authority[2] || '';
 try {
  const readable = host.split('.').map(decodeLabel).join('.');
  return match[1] + readable + port + match[3];
 } catch { return input; }
}
