// Made-up check-ins for `?demo` on the dev server, so the UI can be worked on
// without the report passcode. Same rows every time for a given day. The import
// sits behind import.meta.env.DEV, so none of this reaches a build.
import { addDays } from './report.js'

const KSUM = [
  ['Financial Assistance', 'Asha Nair'],
  ['Financial Assistance', 'Asha Nair'],
  ['Space Requirement', 'Rahul Menon'],
  ['Fab Lab', 'Divya Jose'],
  ['Maker Village', 'Arun Thomas'],
  ['Incubation and Other Startup Enquiries', 'Neha Pillai'],
  ['Incubation and Other Startup Enquiries', 'Neha Pillai'],
  ['Vendors and Suppliers to KSUM', ''],
  ['I have an Appointment', ''],
]
const INCUBATED = ['Meeting', 'Meeting', 'Meeting', 'Interview', 'Internship', 'Repair/Maintenance', 'Staff without ID Card', 'IV', 'Courier drop']
const COMPANIES = ['Acme Labs', 'Riafy', 'Genrobotics', 'Fuselage', 'Sastra Robotics', 'Agrima Infotech']
const EVENTS = ['Startup Meetup', 'Founders Friday', 'AI Workshop']
const ORGS = ['CUSAT', 'Self', 'TCS', 'Rajagiri School of Engineering', 'Freelancer', 'Infopark', 'Model Engineering College', '']
const FIRST = ['Anu', 'Vishnu', 'Meera', 'Fathima', 'Joseph', 'Lakshmi', 'Arjun', 'Sneha', 'Rohit', 'Aisha']
const LAST = ['Nair', 'Menon', 'Thomas', 'Pillai', 'Varghese', 'Kurian', 'Das', 'Rahman']

const pad = (n) => String(n).padStart(2, '0')

export function demoRows(today) {
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const pick = (list) => list[Math.floor(random() * list.length)]

  const rows = []
  const add = (row) => rows.push({ token: `V${101 + rows.length}`, ...row })

  for (let back = 55; back >= 0; back--) {
    const date = addDays(today, -back)
    const weekday = new Date(Date.parse(date)).getUTCDay()
    const visits = weekday === 0 ? 0 : weekday === 6 ? 3 : 8 + Math.floor(random() * 16)
    const times = Array.from({ length: visits }, () => 9 * 60 + Math.floor(random() ** 1.4 * 9 * 60)).sort((a, b) => a - b)

    for (const at of times) {
      const kind = random()
      const visitType = kind < 0.55 ? 'KSUM' : kind < 0.88 ? 'Incubated Company' : 'Attend an Event'
      const [requirement, owner] =
        visitType === 'KSUM' ? pick(KSUM) : [visitType === 'Incubated Company' ? pick(INCUBATED) : visitType, '']
      const eligible = visitType === 'KSUM' && requirement !== 'I have an Appointment'
      const waited = eligible && random() < 0.14 ? 15 + Math.floor(random() * 40) : 0
      const stamp = (minutes) => `${date} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`
      const first = pick(FIRST)
      add({
        timestamp: stamp(at),
        name: `${first} ${pick(LAST)}`,
        phone: `9${String(100000000 + Math.floor(random() * 400)).padStart(9, '0')}`,
        email: `${first.toLowerCase()}@example.com`,
        organisation: pick(ORGS),
        requirement,
        visitType,
        company: visitType === 'KSUM' ? '' : pick(visitType === 'Attend an Event' ? EVENTS : COMPANIES),
        escalatedAt: waited ? stamp(at + waited) : '',
        eligible,
        owner: eligible ? owner : '',
      })
    }
  }
  return rows
}
