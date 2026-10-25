# PreSkool Figma UI kit — design system reference

File key: `DfSa4FTZIeoRuZtclag353` (https://www.figma.com/design/DfSa4FTZIeoRuZtclag353). Reviewed 2026-10-25.

Pages: Cover `9:476` · Design System `0:1` · Menu Components `5028:566553` · Screens `1:3`.

## Design System frames (page `0:1`)

| Frame | Node |
|---|---|
| Colors | `5028:565054` |
| Typography | `2:34` |
| Buttons | `9:415` |
| Forms | `14:28428` |
| Tabler Icon | `14:504` |
| Images | `17:1828` |
| Logo / Logo Dark / Logo Icon | `3:402` / `45:7825` / `45:7842` |
| Checkbox sizing / nesting | `1989:14786` / `1989:14799` |

## Color variables

- **Brand:** Primary `#3D5EE1` · Secondary `#6FCCD8` · Dark `#131022` · Light `#E9EDF4` · White `#FFFFFF`
- **System:** Info `#0F65CD` · Success `#1ABE17` · Warning `#EAB300` · Danger `#E82646` · Sky Blue `#05C3FB`
- **Transparent tints (pill/badge backgrounds):** Primary `#F2F5FF` · Secondary `#E8FCFF` · Dark `#F3F6FF` · Warning `#FEF8EA` · Info `#E7F1FC` · Success `#E8F9E8` · Danger `#FDE9ED` · Sky `#E6F9FF`
- **Grey 100→900:** `#E6E8EB` `#CDD0D7` `#B5B9C3` `#9CA1AF` `#838A9B` `#6A7287` `#515B73` `#39435F` `#202C4B`
- **Light 100→900:** `#FDFDFE` `#FBFBFD` `#F8FAFC` `#F6F8FB` `#F4F6FA` `#F2F4F8` `#F0F2F7` `#EDF1F6` `#E9EDF4`
- **Dark 900→100:** `#0F0C1C` `#131022` `#1B1632` `#322D46` `#5B576B` `#8C8997` `#B9B7C0` `#DBDADF` `#EFEFF2`
- **Primary 100→900:** `#ECEFFC` `#D8DFF9` `#C5CFF6` `#B1BFF3` `#9EAFF0` `#8B9EED` `#778EEA` `#647EE7` `#506EE4`
- **Secondary 100→900:** `#F1FAFB` `#E2F5F7` `#D4F0F3` `#C5EBEF` `#B7E6EC` `#A9E0E8` `#9ADBE4` `#8CD6E0` `#7DD1DC`
- **Warning 100→900:** `#FEF8EA` `#FDF1D6` `#FDE9C1` `#FCE2AD` `#FBDB98` `#FAD483` `#F9CD6F` `#F9C55A` `#F7B731`
- **Info 100→900:** `#E7F1FC` `#CFE2FA` `#B8D4F7` `#A0C6F4` `#88B8F2` `#70A9EF` `#589BEC` `#418DE9` `#1170E4`
- **Success 100→900:** `#E8F9E8` `#D1F2D1` `#BAECB9` `#A3E5A2` `#8DDF8B` `#76D874` `#5FD25D` `#48CB45` `#2ACB27`
- **Danger 100→900:** `#FDE9ED` `#FAD4DA` `#F8BEC8` `#F6A8B5` `#F493A3` `#F17D90` `#EF677E` `#ED516B` `#E82646`
- **Sky Blue 100→900:** `#E6F9FF` `#CDF3FE` `#B4EDFE` `#9BE7FD` `#82E1FD` `#69DBFD` `#50D5FC` `#37CFFC` `#1ECCFF`
- **Theme colors:** Violet `#673AB7` · Pink `#E83E8C` · Orange `#FD7E14` · Green `#2CA87F` · Red `#DC2626`
- **Violet 100→900:** `#F0EBF8` `#E1D8F1` `#D1C4E9` `#C2B0E2` `#B39DDB` `#A489D4` `#9575CD` `#8561C5` `#764EBE`
- **Pink 100→900:** `#FDECF4` `#FAD8E8` `#FAD8E8` `#F6B2D1` `#F49FC6` `#F18BBA` `#EF78AF` `#ED65A3` `#EA5198` (note: 200 and 300 are identical in the source)
- **Orange 100→900:** `#FFF2E8` `#FFE5D0` `#FED8B9` `#FECBA1` `#FEBF8A` `#FEB272` `#FEA55B` `#FD9843` `#FD8B2C`
- **Green 100→900:** `#EAF6F2` `#D5EEE5` `#C0E5D9` `#ABDCCC` `#96D4BF` `#80CBB2` `#6BC2A5` `#56B999` `#41B18C`
- **Red 100→900:** `#FCE9E9` `#F8D4D4` `#F5BEBE` `#F1A8A8` `#EE9393` `#EA7D7D` `#E76767` `#E35151` `#E03C3C`

## Typography (Roboto, line-height 100% in the source)

| Style | Size / weight |
|---|---|
| Display 1–6 | 40/800 · 32/800 · 24/700 · 20/600 · 18/600 · 16/600 |
| H1–H6 | 28/700 · 24/700 · 20/600 · 18/600 · 16/500 · 15/500 |
| Body Large / Medium semibold | 18/600 · 16/600 |
| Body Regular / Small semibold | 14/400 · 14/600 |
| Navigation text | 14/500 |
| XS regular / semibold | 12/400 · 12/600 |

The source uses 100% line height everywhere. In code, use 1.2 for headings and 1.5 for body text for readability.

## Screens (page `1:3`, 1440px wide)

- **Dashboards** `5028:504643`: Admin `5028:504644` · Student `5028:505508` · Teacher `5028:506357` · Parent `5028:507290`
- **People** `5028:513543`: Student grid `5028:522442` · Parent grid `5028:522938` · Guardian grid `5028:523342` · Teacher grid `5028:523746`
- **Academic** `5028:529085`: Class list `2058:370534` · Class room `2058:391971` · Class routine `2058:397338` · Subject `2058:414367` · Syllabus `2058:425882` · Timetable `151:37546` · Exam `2058:445055` · Exam schedule `2095:391693` · Grade `2096:398461`
- **Management** `5028:535728`: Fees group `2104:412223` · Library members `2268:408828` · Sports `2307:416609` · Hostel `2307:429019` · Routes `2307:450602`
- **HRM** `5028:542371`: Department `5028:543315` · Designation `5028:543460` · Leave `5028:543913` · Student attendance `5028:543605` · Holidays `5028:544018` · Payroll `5028:544205`
- **Reports** `5028:543314`: Attendance report `2419:489144` / `2419:490415` · Teacher `2442:469968` · Staff `2442:478827` · Attendance type `2440:454364` · Daily `2442:458481` · Student/Teacher/Staff day-wise `2442:462389` / `2442:466193` / `2442:474193`
- **Authentication** `5028:551645`: Sign in `2083:412529` (and variants `306:293320`, `310:295985`) · Sign up `300:308090` · Forgot `2083:412661` · Reset `2083:412775` · Reset sent `2083:412911` · Email verification `2083:416193` · 2-step `2083:417331`

## Layout observations (from the admin dashboard and student grid)

- Sidebar about 210px wide, white, with grouped uppercase-free section labels in Grey 500 at 12px. The active item has a Primary-tinted background (`#F2F5FF`) with primary text. A campus switcher card sits at the top.
- Top bar: search input with a ⌘K hint, academic-year dropdown, language flag, icon buttons (add, theme, notifications with dot, messages, analytics, fullscreen), avatar.
- Page header: H4-ish title + breadcrumb (Dashboard / Peoples / Students Grid), with right-aligned actions: refresh, print, Export (secondary), Add (primary).
- Cards: white, 1px Grey 100 border, about 5–8px radius, minimal shadow. Card header has the title on the left and filter/dropdown controls on the right.
- Status pills: tinted background + dot + coloured text (Active = success, Inactive = danger).
- Stat cards: icon tile + big number + label + delta badge; Active/Inactive split footer.
- Entity grid card: ID link + status + kebab menu; avatar + name + class/section; three meta fields; footer with chat/call/mail icon buttons + secondary action.
