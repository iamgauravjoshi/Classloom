# Research: academic structure (Phase 1, Part 5)

These notes come from a crawl of the PreSkool demo on 2026-11-04.

## Pages reviewed

### `classes.html`: useful for the list layout

Each class row shows:
- **Identity:** class level, a code (`CLS-2024-001`), the number of sections and a room.
- **Status:** Active, New, Inactive or Archived.
- **People and size:** a category (Primary, Middle, Secondary, Senior Secondary), the class teacher and a student count.

The list filters by category, section, teacher, status, room, strength, subject assignment and academic year. Row actions include "Assign Teacher", "Assign Subjects", "Generate Timetable" and "Promote Students".

The expanded row is a dashboard: teaching staff, class representative, subjects, weekly periods, attendance, grades and events.

### `class-section.html`: the closest match to Classloom's sections

Each section shows:
- **Identity:** a name (Section A), a code, the academic year and its class.
- **Teaching:** the class teacher, the room and floor, the shift (Morning or Afternoon) and the medium (English or Hindi).
- **Capacity:** "42 / 45, 3 seats left", with a boys/girls split.
- **Status:** Active, Full, Inactive or Archived.

Bulk actions are Assign Teacher, Assign Classroom and Update Capacity. Sections belong to an academic year, and an archived section comes from the previous session.

### `class-subject.html`: useful

Each subject has a name and code (`ENG-101`), a group (Core, Science, Languages, Humanities, Technology or Co-curricular), a department, a teacher, the class and section, periods per week and credits. Syllabus units, lessons, assignments and exams are listed too, and those belong to later modules.

### `classrooms.html`: useful for rooms

Each room has:
- **Identity:** a name and number (Newton Hall, Room 101), a building and a floor.
- **Type:** Lecture Hall, Standard, Smart, Seminar, Computer Lab, Science Lab, Art Studio or Music Room.
- **Use:** seat capacity, the assigned class, facilities, equipment, maintenance and bookings.
- **Status:** Available, Occupied, Maintenance, Reserved or Inactive.

## What Classloom takes

- **Sections:** per academic year, with capacity, a room and a class teacher. Seat use is shown once students exist (Phase 2).
- **Subjects:** a code and a scholastic or co-scholastic type, mapped to the classes that take them.
- **Rooms:** campus, name or number, type, capacity and floor.
- **Houses:** not in PreSkool's academic pages, but standard in Indian schools.

What it leaves out for now, and when that comes:
- **Ready to add when needed:** shift and medium per section; buildings; facilities, equipment, maintenance and bookings; subject groups, departments, credits and periods per week.
- **Later modules:** syllabus, lessons and the timetable (Phase 7); teacher-subject assignment (Phase 3); class analytics.

## Indian context

- **Class levels:** Nursery, LKG, UKG, then I–XII. The school profile (Part 4) already stores the range a school offers.
- **Streams:** Science, Commerce and Humanities (Arts) apply in XI–XII. Subjects there are part compulsory (English, plus the stream's core) and part optional (an elective such as Computer Science, Informatics Practices, Physical Education or Psychology).
- **Co-scholastic areas:** CBSE's scheme of studies has Art Education, Health & Physical Education, and Work Education, graded but not marked.
- **CBSE subject codes:** the core codes were confirmed against CBSE's subject-wise candidate statistics (cbse.gov.in, `SUB1017.pdf` for class X and `SUB1217.pdf` for class XII): 184 English Language & Literature, 041 Mathematics, 042 Physics, 043 Chemistry, 044 Biology, 301 English Core. The other codes in the starter list follow CBSE's current scheme of studies. Codes are editable, because boards revise them.
