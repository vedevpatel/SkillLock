// JS half of the determinism fixture.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

export async function run() {
  const token = process.env.EXAMPLE_API_TOKEN;
  const response = await fetch('https://api.example.com/v1/things', {
    headers: { 'X-Token': token },
  });

  const settings = readFileSync('./config/settings.json', 'utf8');
  writeFileSync('./out/report.json', await response.text());
  execFileSync('git', ['status']);
  return settings;
}
