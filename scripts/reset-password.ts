import { createInterface } from 'node:readline'
import { hashSync } from 'bcryptjs'
import { getDb } from '../server/db.js'

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer)
    })
  })
}

async function main() {
  const db = getDb()

  const users = db.prepare('SELECT email FROM users').all() as { email: string }[]
  if (users.length === 0) {
    console.error('No users found in database.')
    process.exit(1)
  }

  let email: string
  if (users.length === 1) {
    email = users[0].email
    console.log(`User: ${email}`)
  } else {
    console.log('Users:')
    users.forEach((u, i) => console.log(`  ${i + 1}. ${u.email}`))
    const choice = await prompt('Select user number: ')
    const idx = parseInt(choice, 10) - 1
    if (isNaN(idx) || idx < 0 || idx >= users.length) {
      console.error('Invalid selection.')
      process.exit(1)
    }
    email = users[idx].email
  }

  const password = await prompt('New password: ')
  if (!password) {
    console.error('Password cannot be empty.')
    process.exit(1)
  }

  const hash = hashSync(password, 12)
  db.prepare(
    "UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = datetime('now') WHERE email = ?",
  ).run(hash, email)

  console.log(`Password reset for ${email}.`)
}

main()
