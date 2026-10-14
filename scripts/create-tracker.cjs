const ExcelJS = require('exceljs')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'NfinityHQ'
  const log = workbook.addWorksheet('Call Log')
  log.getCell('A1').value = 'Call tracker'
  log.getRow(2).values = ['Date', 'Business Name', 'Contact / Owner Name', 'Phone', 'Industry', 'State/Province', 'Status', 'Decision Maker?', 'Interest', 'Pain Point', 'Follow-Up Date', 'Notes']
  log.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  log.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17365D' } }
  log.columns.forEach(column => { column.width = 24 })
  log.views = [{ state: 'frozen', ySplit: 2 }]
  log.autoFilter = 'A2:L2'
  const dashboard = workbook.addWorksheet('Dashboard')
  dashboard.getCell('A1').value = 'Call summary'
  dashboard.getCell('A3').value = 'Logged calls'
  dashboard.getCell('B3').value = { formula: "COUNTA('Call Log'!A4:A1048576)" }
  dashboard.getCell('A4').value = 'Connected'
  dashboard.getCell('B4').value = { formula: 'COUNTIF(\'Call Log\'!G4:G1048576,"Connected")' }
  dashboard.columns.forEach(column => { column.width = 26 })
  const target = path.join(__dirname, '../resources/tracker_template.xlsx')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  await workbook.xlsx.writeFile(target)
  console.log('Created an empty call tracker. No contact data is bundled.')
}

main().catch(() => { console.error('Could not create the blank call tracker.'); process.exitCode = 1 })
