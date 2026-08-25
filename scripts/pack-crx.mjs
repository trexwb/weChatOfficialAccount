#!/usr/bin/env node
/**
 * CRX3 打包脚本（零依赖，Node 18+）
 *
 * 用法: node scripts/pack-crx.mjs <zip路径> <私钥pem路径> <输出crx路径>
 * 私钥生成: openssl genrsa -out key.pem 2048
 *
 * 说明:
 * - CRX3 = "Cr24" + version(3) + header_len + protobuf 头(公钥+签名) + ZIP 归档
 * - 签名 = RSA-SHA256(ZIP 归档字节)
 * - 自签 CRX 仅适用于企业策略安装（ExtensionInstallForcelist）；
 *   Chrome 137+ 已禁止普通用户拖拽安装 sideload CRX。
 * - 私钥务必持久保存（GitHub Secret），换钥会导致扩展 ID 变化、用户需重装。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';

const [, , zipPath, keyPath, outPath] = process.argv;
if (!zipPath || !keyPath || !outPath) {
  console.error('用法: node scripts/pack-crx.mjs <zip> <key.pem> <out.crx>');
  process.exit(1);
}

const zip = readFileSync(zipPath);
const privateKey = crypto.createPrivateKey(readFileSync(keyPath));
const pubDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
const signature = crypto.sign('RSA-SHA256', zip, privateKey);

/* ── 极简 protobuf 编码（仅本格式所需） ── */
function varint(n) {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}

function lenField(fieldNum, data) {
  return Buffer.concat([varint((fieldNum << 3) | 2), varint(data.length), data]);
}

function u32le(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

// AsymmetricKeyProof { bytes public_key = 1; bytes signature = 2; }
const proof = Buffer.concat([lenField(1, pubDer), lenField(2, signature)]);
// CrxFileHeader { repeated AsymmetricKeyProof sha256_with_rsa = 2; }
const header = lenField(2, proof);

const crx = Buffer.concat([
  Buffer.from('Cr24', 'latin1'),
  u32le(3),
  u32le(header.length),
  header,
  zip
]);

writeFileSync(outPath, crx);

/* ── 扩展 ID（企业策略安装用）: base32(sha256(pubKey)) 前 32 字符，字母表 a-p ── */
const ALPHABET = 'abcdefghijklmnop';
const digest = crypto.createHash('sha256').update(pubDer).digest();
let id = '';
for (let i = 0; i < 16; i++) {
  id += ALPHABET[(digest[i] >> 4) & 0x0f] + ALPHABET[digest[i] & 0x0f];
}

console.log(`✓ 已生成 ${outPath} (${crx.length} bytes)`);
console.log(`扩展 ID: ${id}`);
