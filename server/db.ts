import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth.ts';
import crypto from 'node:crypto';
import type {
  AcademicYear,
  AdminNote,
  AdminPermissions,
  AdminRole,
  AdminUser,
  Announcement,
  AuditLog,
  Exam,
  ExemptionDecision,
  Grade6OverallQualification,
  Grade6SubjectQualification,
  GradeObjection,
  GradeRecord,
  MinisterialDecision,
  OverallExemption,
  PublicObjectionNoticeItem,
  PublishLink,
  SchoolClass,
  SchoolSettings,
  Section,
  Student,
  Subject,
  SubjectExemption,
  TeacherAssignment,
} from '../src/types/school.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BACKUPS_DIR = path.resolve(process.cwd(), 'backups');
const DB_PATH = path.join(DATA_DIR, 'school.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUPS_DIR, { recursive: true });

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('foreign_keys = ON');
    dbInstance.pragma('journal_mode = WAL');
    initializeSchema(dbInstance);
    seedInitialData(dbInstance);
  }
  return dbInstance;
}

export function getDbPath(): string {
  return DB_PATH;
}

export function getBackupsDir(): string {
  return BACKUPS_DIR;
}

function tableHasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === columnName);
}

function getTableSql(db: Database.Database, tableName: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql?: string } | undefined;
  return row?.sql || '';
}

function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS academic_years (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_current INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      grade6_max_fail_subjects INTEGER NOT NULL DEFAULT 3,
      grade6_decision_bonus INTEGER NOT NULL DEFAULT 10,
      exemption_general_min_avg REAL NOT NULL DEFAULT 75,
      exemption_min_subject REAL NOT NULL DEFAULT 75,
      exemption_individual_min REAL NOT NULL DEFAULT 90,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      display_order INTEGER NOT NULL DEFAULT 1,
      is_ministerial INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      academic_year_id INTEGER NOT NULL DEFAULT 1,
      class_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(academic_year_id, class_id, name),
      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      academic_year_id INTEGER NOT NULL DEFAULT 1,
      full_name TEXT NOT NULL,
      inquiry_code TEXT NOT NULL,
      class_id INTEGER NOT NULL,
      section_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(academic_year_id, inquiry_code),
      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT,
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      academic_year_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      max_score REAL NOT NULL DEFAULT 100,
      display_order INTEGER NOT NULL DEFAULT 1,
      class_id INTEGER NULL,
      section_id INTEGER NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      academic_year_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      academic_year TEXT NOT NULL DEFAULT '2025 - 2026',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(academic_year_id, name),
      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      academic_year_id INTEGER NOT NULL DEFAULT 1,
      student_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      exam_id INTEGER NOT NULL,
      score REAL NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','ready','published','withdrawn','archived')),
      notes TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT NULL,
      UNIQUE(student_id, subject_id, exam_id),
      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT,
      FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS grade6_subject_qualifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      academic_year_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      decision TEXT NULL CHECK (decision IN ('qualified','not_qualified')),
      decision_source TEXT NOT NULL DEFAULT 'manual' CHECK (decision_source IN ('manual','import','approved_calculation')),
      bonus_applied REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
      notes TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT NULL,
      UNIQUE(academic_year_id, student_id, subject_id),
      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS grade6_overall_qualifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      academic_year_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      decision TEXT NULL CHECK (decision IN ('qualified','not_qualified')),
      decision_source TEXT NOT NULL DEFAULT 'manual' CHECK (decision_source IN ('manual','import','approved_calculation')),
      bonus_used REAL NOT NULL DEFAULT 0,
      max_fail_subjects INTEGER NOT NULL DEFAULT 3,
      decision_bonus_limit REAL NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
      notes TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT NULL,
      UNIQUE(academic_year_id, student_id),
      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS exemptions_subject (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      academic_year_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      decision TEXT NULL CHECK (decision IN ('exempt','not_exempt')),
      exemption_type TEXT NOT NULL DEFAULT 'individual' CHECK (exemption_type IN ('individual','general')),
      decision_source TEXT NOT NULL DEFAULT 'manual' CHECK (decision_source IN ('manual','import','approved_calculation')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
      notes TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT NULL,
      UNIQUE(academic_year_id, student_id, subject_id),
      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS exemptions_overall (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      academic_year_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      decision TEXT NULL CHECK (decision IN ('exempt','not_exempt')),
      annual_average REAL NULL,
      decision_source TEXT NOT NULL DEFAULT 'manual' CHECK (decision_source IN ('manual','import','approved_calculation')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
      notes TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT NULL,
      UNIQUE(academic_year_id, student_id),
      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS grade_objections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      academic_year_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      exam_id INTEGER NOT NULL,
      recorded_score REAL NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','matching','mismatching')),
      corrected_score REAL NULL,
      admin_note TEXT NOT NULL DEFAULT '',
      is_published INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT NULL,
      resolved_by TEXT NULL,
      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
      FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner','supervisor','teacher')),
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      google_email TEXT NULL,
      permissions_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS teacher_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      academic_year_id INTEGER NOT NULL DEFAULT 1,
      admin_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      section_id INTEGER NULL,
      subject_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
      FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      publish_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','draft','archived')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_username TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'navy',
      pinned INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS publish_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      academic_year_id INTEGER NOT NULL DEFAULT 1,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      class_id INTEGER NOT NULL,
      section_id INTEGER NULL,
      subject_id INTEGER NULL,
      exam_id INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
      FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
    );
  `);

  // Ensure default Academic Year row exists before migrating existing rows
  const yearCount = (db.prepare('SELECT COUNT(*) as count FROM academic_years').get() as { count: number }).count;
  if (yearCount === 0) {
    const yearSetting = db.prepare("SELECT value FROM settings WHERE key = 'academicYear'").get() as
      | { value?: string }
      | undefined;
    const defaultYearName = (yearSetting?.value || '2025 - 2026').trim();
    db.prepare(`
      INSERT INTO academic_years (id, name, is_current, is_active, grade6_max_fail_subjects, grade6_decision_bonus)
      VALUES (1, ?, 1, 1, 3, 10)
    `).run(defaultYearName);
  }

  // Idempotent migration: academic_years exemption thresholds
  if (!tableHasColumn(db, 'academic_years', 'exemption_general_min_avg')) {
    db.exec('ALTER TABLE academic_years ADD COLUMN exemption_general_min_avg REAL NOT NULL DEFAULT 75');
  }
  if (!tableHasColumn(db, 'academic_years', 'exemption_min_subject')) {
    db.exec('ALTER TABLE academic_years ADD COLUMN exemption_min_subject REAL NOT NULL DEFAULT 75');
  }
  if (!tableHasColumn(db, 'academic_years', 'exemption_individual_min')) {
    db.exec('ALTER TABLE academic_years ADD COLUMN exemption_individual_min REAL NOT NULL DEFAULT 90');
  }

  // Idempotent migration: admins.google_email
  if (!tableHasColumn(db, 'admins', 'google_email')) {
    db.exec('ALTER TABLE admins ADD COLUMN google_email TEXT NULL');
  }

  // Idempotent migration: classes.is_ministerial
  if (!tableHasColumn(db, 'classes', 'is_ministerial')) {
    db.exec('ALTER TABLE classes ADD COLUMN is_ministerial INTEGER NOT NULL DEFAULT 0');
    db.exec("UPDATE classes SET is_ministerial = 1 WHERE name LIKE '%السادس%'");
  }

  // Idempotent migration: rebuild sections to scope UNIQUE(academic_year_id, class_id, name)
  const sectionsSql = getTableSql(db, 'sections');
  if (!tableHasColumn(db, 'sections', 'academic_year_id') || !sectionsSql.includes('academic_year_id, class_id, name')) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE sections_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          academic_year_id INTEGER NOT NULL DEFAULT 1,
          class_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(academic_year_id, class_id, name),
          FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
          FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT
        );
        INSERT INTO sections_migrated (id, academic_year_id, class_id, name, is_active, created_at)
        SELECT id, 1, class_id, name, is_active, created_at FROM sections;
        DROP TABLE sections;
        ALTER TABLE sections_migrated RENAME TO sections;
      `);
    })();
    db.pragma('foreign_keys = ON');
  }

  // Idempotent migration: rebuild students to scope UNIQUE(academic_year_id, inquiry_code)
  const studentsSql = getTableSql(db, 'students');
  if (!tableHasColumn(db, 'students', 'academic_year_id') || !studentsSql.includes('academic_year_id, inquiry_code')) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE students_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          academic_year_id INTEGER NOT NULL DEFAULT 1,
          full_name TEXT NOT NULL,
          inquiry_code TEXT NOT NULL,
          class_id INTEGER NOT NULL,
          section_id INTEGER NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(academic_year_id, inquiry_code),
          FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
          FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT,
          FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT
        );
        INSERT INTO students_migrated (id, academic_year_id, full_name, inquiry_code, class_id, section_id, is_active, notes, created_at, updated_at)
        SELECT id, 1, full_name, inquiry_code, class_id, section_id, is_active, notes, created_at, updated_at FROM students;
        DROP TABLE students;
        ALTER TABLE students_migrated RENAME TO students;
      `);
    })();
    db.pragma('foreign_keys = ON');
  }

  // Idempotent migration: rebuild exams to scope UNIQUE(academic_year_id, name)
  const examsSql = getTableSql(db, 'exams');
  if (!tableHasColumn(db, 'exams', 'academic_year_id') || !examsSql.includes('academic_year_id, name')) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE exams_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          academic_year_id INTEGER NOT NULL DEFAULT 1,
          name TEXT NOT NULL,
          display_order INTEGER NOT NULL DEFAULT 1,
          is_active INTEGER NOT NULL DEFAULT 1,
          academic_year TEXT NOT NULL DEFAULT '2025 - 2026',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(academic_year_id, name),
          FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE
        );
        INSERT INTO exams_migrated (id, academic_year_id, name, display_order, is_active, academic_year, created_at)
        SELECT id, 1, name, display_order, is_active, academic_year, created_at FROM exams;
        DROP TABLE exams;
        ALTER TABLE exams_migrated RENAME TO exams;
      `);
    })();
    db.pragma('foreign_keys = ON');
  }

  // Idempotent column additions on remaining tables
  for (const tbl of ['subjects', 'grades', 'teacher_assignments', 'publish_links']) {
    if (!tableHasColumn(db, tbl, 'academic_year_id')) {
      db.exec(`ALTER TABLE ${tbl} ADD COLUMN academic_year_id INTEGER NOT NULL DEFAULT 1`);
    }
  }

  // Idempotent migration if existing admins table was created without 'teacher' in CHECK constraint
  const adminsSql = getTableSql(db, 'admins');
  if (adminsSql && !adminsSql.includes("'teacher'")) {
    db.pragma('foreign_keys = OFF');
    const migrateTx = db.transaction(() => {
      db.exec(`
        CREATE TABLE admins_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('owner','supervisor','teacher')),
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          permissions_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_login_at TEXT NULL
        );
        INSERT INTO admins_migrated (id, username, full_name, role, password_hash, password_salt, is_active, permissions_json, created_at, last_login_at)
        SELECT id, username, full_name, role, password_hash, password_salt, is_active, permissions_json, created_at, last_login_at FROM admins;
        DROP TABLE admins;
        ALTER TABLE admins_migrated RENAME TO admins;
      `);
    });
    migrateTx();
    db.pragma('foreign_keys = ON');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_students_inquiry_code ON students(inquiry_code);
    CREATE INDEX IF NOT EXISTS idx_students_year ON students(academic_year_id, class_id, section_id);
    CREATE INDEX IF NOT EXISTS idx_sections_year ON sections(academic_year_id, class_id);
    CREATE INDEX IF NOT EXISTS idx_subjects_year ON subjects(academic_year_id);
    CREATE INDEX IF NOT EXISTS idx_exams_year ON exams(academic_year_id);
    CREATE INDEX IF NOT EXISTS idx_grades_lookup ON grades(student_id, exam_id, status);
    CREATE INDEX IF NOT EXISTS idx_grades_batch ON grades(exam_id, subject_id, status);
    CREATE INDEX IF NOT EXISTS idx_grades_year ON grades(academic_year_id);
    CREATE INDEX IF NOT EXISTS idx_g6_subj_qual_lookup ON grade6_subject_qualifications(academic_year_id, student_id, status);
    CREATE INDEX IF NOT EXISTS idx_g6_overall_qual_lookup ON grade6_overall_qualifications(academic_year_id, student_id, status);
    CREATE INDEX IF NOT EXISTS idx_exempt_subj_lookup ON exemptions_subject(academic_year_id, student_id, status);
    CREATE INDEX IF NOT EXISTS idx_exempt_overall_lookup ON exemptions_overall(academic_year_id, student_id, status);
    CREATE INDEX IF NOT EXISTS idx_objections_lookup ON grade_objections(academic_year_id, status, is_published);
    CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status, publish_date);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_teacher_assignments_admin ON teacher_assignments(admin_id, academic_year_id);
    CREATE INDEX IF NOT EXISTS idx_publish_links_slug ON publish_links(slug);
    CREATE INDEX IF NOT EXISTS idx_subjects_class ON subjects(academic_year_id, class_id);
  `);
}

export function getDefaultCurriculumForClassName(className: string): string[] {
  const n = className.trim();
  if (n.includes('الرابع') && n.includes('علمي')) {
    return [
      'التربية الإسلامية',
      'اللغة العربية',
      'اللغة الإنكليزية',
      'اللغة الكردية',
      'جرائم حزب البعث',
      'الرياضيات',
      'الأحياء',
      'الكيمياء',
      'الفيزياء',
      'التربية الفنية',
      'التربية الرياضية',
    ];
  }
  if (n.includes('الرابع') && n.includes('أدبي')) {
    return [
      'التربية الإسلامية',
      'اللغة العربية',
      'اللغة الإنكليزية',
      'اللغة الكردية',
      'جرائم حزب البعث',
      'التاريخ',
      'الجغرافية',
      'الرياضيات',
      'علم الاجتماع',
      'التربية الفنية',
      'التربية الرياضية',
    ];
  }
  if (n.includes('الخامس') && n.includes('علمي')) {
    return [
      'التربية الإسلامية',
      'اللغة العربية',
      'اللغة الإنكليزية',
      'اللغة الكردية',
      'علم الأرض',
      'الرياضيات',
      'الأحياء',
      'الكيمياء',
      'الفيزياء',
      'التربية الفنية',
      'التربية الرياضية',
    ];
  }
  if (n.includes('الخامس') && n.includes('أدبي')) {
    return [
      'التربية الإسلامية',
      'اللغة العربية',
      'اللغة الإنكليزية',
      'اللغة الكردية',
      'التاريخ',
      'الجغرافية',
      'الرياضيات',
      'الفلسفة وعلم النفس',
      'التربية الفنية',
      'التربية الرياضية',
    ];
  }
  if (n.includes('السادس') && n.includes('علمي')) {
    return [
      'التربية الإسلامية',
      'اللغة العربية',
      'اللغة الإنكليزية',
      'الأحياء',
      'الرياضيات',
      'الكيمياء',
      'الفيزياء',
      'التربية الفنية',
      'التربية الرياضية',
    ];
  }
  if (n.includes('السادس') && n.includes('أدبي')) {
    return [
      'التربية الإسلامية',
      'اللغة العربية',
      'اللغة الإنكليزية',
      'التاريخ',
      'الجغرافية',
      'الاقتصاد',
      'الرياضيات',
      'التربية الفنية',
      'التربية الرياضية',
    ];
  }
  return [
    'التربية الإسلامية',
    'اللغة العربية',
    'اللغة الإنكليزية',
    'الرياضيات',
    'الأحياء',
    'الكيمياء',
    'الفيزياء',
    'التربية الفنية',
    'التربية الرياضية',
  ];
}

export const OWNER_DEFAULT_PERMISSIONS: AdminPermissions = {
  manageStudents: true,
  manageStructure: true,
  manageGrades: true,
  publishGrades: true,
  manageImportExport: true,
  manageAnnouncements: true,
  manageSettings: true,
  manageNotes: true,
};

function seedInitialData(db: Database.Database): void {
  const adminCount = (db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number }).count;
  if (adminCount === 0) {
    const initialUsername = process.env.INITIAL_OWNER_USERNAME || 'admin2023';
    const initialPassword = process.env.INITIAL_OWNER_PASSWORD || 'mntzr2023';
    const { hash, salt } = hashPassword(initialPassword);
    db.prepare(`
      INSERT INTO admins (username, full_name, role, password_hash, password_salt, is_active, permissions_json)
      VALUES (?, ?, 'owner', ?, ?, 1, ?)
    `).run(
      initialUsername,
      'مدير النظام والمالك الأساسي',
      hash,
      salt,
      JSON.stringify(OWNER_DEFAULT_PERMISSIONS)
    );
  }

  // Idempotent migration to secret owner credentials (admin2023 / mntzr2023)
  const migratedOwner = db.prepare("SELECT value FROM settings WHERE key = 'migrated_owner_admin2023_v1'").get();
  if (!migratedOwner) {
    const ownerUsername = process.env.INITIAL_OWNER_USERNAME || 'admin2023';
    const ownerPassword = process.env.INITIAL_OWNER_PASSWORD || 'mntzr2023';
    const { hash, salt } = hashPassword(ownerPassword);
    const ownerRow = db
      .prepare("SELECT id, username FROM admins WHERE role = 'owner' ORDER BY id ASC LIMIT 1")
      .get() as { id: number; username: string } | undefined;

    if (ownerRow) {
      db.prepare(`
        UPDATE admins
        SET username = ?, password_hash = ?, password_salt = ?, is_active = 1
        WHERE id = ?
      `).run(ownerUsername, hash, salt, ownerRow.id);

      const legacyUsers = [ownerRow.username, 'mmzr2023', '@mmzr2023'].filter((u) => u !== ownerUsername);
      for (const oldUser of legacyUsers) {
        db.prepare('UPDATE grades SET updated_by = ? WHERE updated_by = ?').run(ownerUsername, oldUser);
        db.prepare('UPDATE announcements SET created_by = ? WHERE created_by = ?').run(ownerUsername, oldUser);
        db.prepare('UPDATE admin_notes SET updated_by = ? WHERE updated_by = ?').run(ownerUsername, oldUser);
        db.prepare('UPDATE audit_logs SET actor_username = ? WHERE actor_username = ?').run(ownerUsername, oldUser);
      }
    }

    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('migrated_owner_admin2023_v1', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
    ).run();
  }

  const settingsCount = (db.prepare('SELECT COUNT(*) as count FROM settings').get() as { count: number }).count;
  if (settingsCount === 0) {
    const defaults: Record<string, string> = {
      schoolName: 'إعدادية المنتظر للبنين',
      republicHeader: 'جمهورية العراق',
      ministryHeader: 'وزارة التربية',
      directorate: 'المديرية العامة لتربية واسط',
      academicYear: '2025 - 2026',
      contactInfo: 'محافظة واسط — جمهورية العراق · البريد الرسمي لإدارة الامتحانات',
      footerText: 'هذا الكشف صادر إلكترونياً عن اللجنة الامتحانية وإدارة إعدادية المنتظر للبنين، ولا يعتد بالنسخ المعدلة يدوياً.',
      printNote: 'معتمد للطباعة الرسمية على ورق A4',
      emblemUrl: '/assets/aistudio/school_logo_original_f35f0f97.jpg',
      ministrySealUrl: '/src/assets/images/ministry_seal_emblem_1795173275872.jpg',
      primaryColor: '#0B1F3A',
      accentColor: '#C59B27',
    };
    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    const tx = db.transaction(() => {
      for (const [k, v] of Object.entries(defaults)) {
        insertSetting.run(k, v);
      }
    });
    tx();
  } else {
    db.prepare(
      "UPDATE settings SET value = 'المديرية العامة لتربية واسط' WHERE key = 'directorate' AND value = 'المديرية العامة للتربية في محافظة بغداد / الرصافة'"
    ).run();
    db.prepare(
      "UPDATE settings SET value = 'محافظة واسط — جمهورية العراق · البريد الرسمي لإدارة الامتحانات' WHERE key = 'contactInfo' AND value LIKE 'بغداد%'"
    ).run();
    const migratedLogo = db.prepare("SELECT value FROM settings WHERE key = 'migrated_original_emblem_f35f0f97_v1'").get();
    if (!migratedLogo) {
      db.prepare(
        "UPDATE settings SET value = '/assets/aistudio/school_logo_original_f35f0f97.jpg' WHERE key = 'emblemUrl' AND (value = '/src/assets/images/school_emblem_1795173276794.jpg' OR value = '/src/assets/images/school_logo_original.svg')"
      ).run();
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('migrated_original_emblem_f35f0f97_v1', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
      ).run();
    }
  }

  // Idempotent migration of exam names to Iraqi Semester 1 / Semester 2 structure
  const examRenames: Array<[string, string]> = [
    ['الشهر الأول', 'الشهر الأول (الفصل الأول)'],
    ['الشهر الثاني', 'الشهر الثاني (الفصل الأول)'],
    ['الشهر الثالث', 'الشهر الأول (الفصل الثاني)'],
    ['الشهر الرابع', 'الشهر الثاني (الفصل الثاني)'],
  ];
  for (const [oldName, newName] of examRenames) {
    const existsNew = db.prepare('SELECT id FROM exams WHERE name = ?').get(newName);
    if (!existsNew) {
      db.prepare('UPDATE exams SET name = ? WHERE name = ?').run(newName, oldName);
    }
  }

  const classesCount = (db.prepare('SELECT COUNT(*) as count FROM classes').get() as { count: number }).count;
  if (classesCount > 0) {
    // Ensure Iraqi semester effort exams & sample student 2026102 full semester dataset exist in persisted DBs
    const migratedIraqiExams = db.prepare("SELECT value FROM settings WHERE key = 'migrated_iraqi_card_exams_v1'").get();
    if (!migratedIraqiExams) {
      const targetOrder: Array<[string, number]> = [
        ['الشهر الأول (الفصل الأول)', 1],
        ['الشهر الثاني (الفصل الأول)', 2],
        ['سعي الفصل الأول', 3],
        ['نصف السنة', 4],
        ['الشهر الأول (الفصل الثاني)', 5],
        ['الشهر الثاني (الفصل الثاني)', 6],
        ['سعي الفصل الثاني', 7],
        ['السعي السنوي', 8],
        ['الامتحان النهائي', 9],
        ['الدرجة النهائية', 10],
      ];
      const upsertExam = db.prepare(`
        INSERT INTO exams (academic_year_id, name, display_order, is_active, academic_year)
        VALUES (1, ?, ?, 1, '2025 - 2026')
        ON CONFLICT(academic_year_id, name) DO UPDATE SET display_order = excluded.display_order
      `);
      for (const [name, order] of targetOrder) {
        upsertExam.run(name, order);
      }

      // Idempotently populate student 2026102 with complete Semester 1 + Midyear + Semester 2 published grades
      const stu2 = db.prepare("SELECT id FROM students WHERE inquiry_code = '2026102'").get() as { id: number } | undefined;
      if (stu2) {
        const subjectRows = db
          .prepare('SELECT id FROM subjects WHERE is_active = 1 ORDER BY display_order ASC, id ASC')
          .all() as Array<{ id: number }>;
        const examRows = db.prepare('SELECT id, name FROM exams WHERE academic_year_id = 1').all() as Array<{ id: number; name: string }>;
        const examIdByName = new Map(examRows.map((e) => [e.name, e.id]));

        const sem1M2Id = examIdByName.get('الشهر الثاني (الفصل الأول)');
        const midId = examIdByName.get('نصف السنة');
        const sem2M1Id = examIdByName.get('الشهر الأول (الفصل الثاني)');
        const sem2M2Id = examIdByName.get('الشهر الثاني (الفصل الثاني)');

        const sem1M2Scores = [86, 81, 80, 90, 74, 83, 87, 92];
        const midScores = [85, 80, 81, 89, 75, 82, 86, 91];
        const sem2M1Scores = [87, 83, 84, 91, 78, 84, 88, 93];
        const sem2M2Scores = [89, 85, 86, 93, 80, 86, 90, 95];

        const insertIfAbsent = db.prepare(`
          INSERT OR IGNORE INTO grades (academic_year_id, student_id, subject_id, exam_id, score, status, notes, updated_by, published_at)
          VALUES (1, ?, ?, ?, ?, 'published', '', 'admin2023', ?)
        `);

        subjectRows.forEach((subj, idx) => {
          if (idx >= sem1M2Scores.length) return;
          if (sem1M2Id) insertIfAbsent.run(stu2.id, subj.id, sem1M2Id, sem1M2Scores[idx], '2026-03-01 10:00:00');
          if (midId) insertIfAbsent.run(stu2.id, subj.id, midId, midScores[idx], '2026-03-10 09:00:00');
          if (sem2M1Id) insertIfAbsent.run(stu2.id, subj.id, sem2M1Id, sem2M1Scores[idx], '2026-04-12 10:00:00');
          if (sem2M2Id) insertIfAbsent.run(stu2.id, subj.id, sem2M2Id, sem2M2Scores[idx], '2026-05-04 10:00:00');
        });
      }

      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('migrated_iraqi_card_exams_v1', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
      ).run();
    }

    const migratedFinalExam = db.prepare("SELECT value FROM settings WHERE key = 'migrated_final_grade_exam_v1'").get();
    if (!migratedFinalExam) {
      db.prepare(`
        INSERT INTO exams (academic_year_id, name, display_order, is_active, academic_year)
        VALUES (1, 'الدرجة النهائية', 10, 1, '2025 - 2026')
        ON CONFLICT(academic_year_id, name) DO UPDATE SET display_order = 10
      `).run();
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('migrated_final_grade_exam_v1', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
      ).run();
    }
    const migratedSecondRound = db.prepare("SELECT value FROM settings WHERE key = 'migrated_second_round_exam_v1'").get();
    if (!migratedSecondRound) {
      const years = db.prepare('SELECT id, name FROM academic_years').all() as Array<{ id: number; name: string }>;
      for (const yr of years) {
        db.prepare(`
          INSERT INTO exams (academic_year_id, name, display_order, is_active, academic_year)
          VALUES (?, 'الدور الثاني', 11, 1, ?)
          ON CONFLICT(academic_year_id, name) DO UPDATE SET display_order = 11, is_active = 1
        `).run(yr.id, yr.name);
      }
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('migrated_second_round_exam_v1', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
      ).run();
    }

    // Idempotent migration: convert global shared subjects (class_id IS NULL) into independent per-class subjects
    // and ensure exact Iraqi curriculum subjects exist per class cleanly without losing grades or assignments.
    const migratedClassSubjects = db
      .prepare("SELECT value FROM settings WHERE key = 'migrated_class_specific_subjects_v1'")
      .get();
    if (!migratedClassSubjects) {
      const allYears = db.prepare('SELECT id FROM academic_years').all() as Array<{ id: number }>;
      const allClasses = db
        .prepare('SELECT id, name FROM classes ORDER BY display_order ASC, id ASC')
        .all() as Array<{ id: number; name: string }>;

      db.pragma('foreign_keys = OFF');
      const migrateSubjectsTx = db.transaction(() => {
        for (const yr of allYears) {
          const sharedSubjects = db
            .prepare(
              'SELECT id, name, max_score as maxScore, display_order as displayOrder, is_active as isActive FROM subjects WHERE academic_year_id = ? AND class_id IS NULL ORDER BY display_order ASC, id ASC'
            )
            .all(yr.id) as Array<{
            id: number;
            name: string;
            maxScore: number;
            displayOrder: number;
            isActive: number;
          }>;

          // Map (oldSharedSubjectId -> classId -> newClassSubjectId)
          const remapByOldAndClass = new Map<string, number>();

          for (const cls of allClasses) {
            const curriculumNames = getDefaultCurriculumForClassName(cls.name);
            const curriculumSet = new Set(curriculumNames);

            // Check existing class-specific subjects
            const existingClassSubs = db
              .prepare(
                'SELECT id, name FROM subjects WHERE academic_year_id = ? AND class_id = ?'
              )
              .all(yr.id, cls.id) as Array<{ id: number; name: string }>;
            const classSubByName = new Map(existingClassSubs.map((s) => [s.name.trim(), s.id]));

            // Ensure all default curriculum subjects exist for this class
            curriculumNames.forEach((subjName, idx) => {
              if (!classSubByName.has(subjName)) {
                const matchingShared = sharedSubjects.find((s) => s.name.trim() === subjName);
                const info = db
                  .prepare(
                    'INSERT INTO subjects (academic_year_id, name, max_score, display_order, class_id, section_id, is_active) VALUES (?, ?, ?, ?, ?, NULL, 1)'
                  )
                  .run(yr.id, subjName, matchingShared?.maxScore ?? 100, idx + 1, cls.id);
                classSubByName.set(subjName, Number(info.lastInsertRowid));
              }
            });

            // Clone any additional shared subjects that have grades/assignments in this class (e.g. الحاسوب)
            for (const shared of sharedSubjects) {
              const sName = shared.name.trim();
              let targetId = classSubByName.get(sName);
              if (!targetId) {
                const hasRef =
                  db
                    .prepare(
                      `SELECT 1 FROM grades g JOIN students st ON st.id = g.student_id
                       WHERE g.subject_id = ? AND st.class_id = ? AND g.academic_year_id = ? LIMIT 1`
                    )
                    .get(shared.id, cls.id, yr.id) ||
                  db
                    .prepare(
                      'SELECT 1 FROM teacher_assignments WHERE subject_id = ? AND class_id = ? AND academic_year_id = ? LIMIT 1'
                    )
                    .get(shared.id, cls.id, yr.id);

                if (hasRef || !curriculumSet.size) {
                  const info = db
                    .prepare(
                      'INSERT INTO subjects (academic_year_id, name, max_score, display_order, class_id, section_id, is_active) VALUES (?, ?, ?, ?, ?, NULL, ?)'
                    )
                    .run(yr.id, sName, shared.maxScore, shared.displayOrder, cls.id, shared.isActive);
                  targetId = Number(info.lastInsertRowid);
                  classSubByName.set(sName, targetId);
                }
              }
              if (targetId) {
                remapByOldAndClass.set(`${shared.id}:${cls.id}`, targetId);
              }
            }
          }

          // Remap grades, qualifications, exemptions, objections, publish_links, teacher_assignments
          for (const shared of sharedSubjects) {
            const stuGrades = db
              .prepare(
                `SELECT g.id, st.class_id as classId
                 FROM grades g JOIN students st ON st.id = g.student_id
                 WHERE g.subject_id = ? AND g.academic_year_id = ?`
              )
              .all(shared.id, yr.id) as Array<{ id: number; classId: number }>;
            for (const g of stuGrades) {
              const newId = remapByOldAndClass.get(`${shared.id}:${g.classId}`);
              if (newId) {
                db.prepare('UPDATE OR IGNORE grades SET subject_id = ? WHERE id = ?').run(newId, g.id);
              }
            }

            const quals = db
              .prepare(
                `SELECT q.id, st.class_id as classId
                 FROM grade6_subject_qualifications q JOIN students st ON st.id = q.student_id
                 WHERE q.subject_id = ? AND q.academic_year_id = ?`
              )
              .all(shared.id, yr.id) as Array<{ id: number; classId: number }>;
            for (const q of quals) {
              const newId = remapByOldAndClass.get(`${shared.id}:${q.classId}`);
              if (newId) {
                db.prepare('UPDATE OR IGNORE grade6_subject_qualifications SET subject_id = ? WHERE id = ?').run(
                  newId,
                  q.id
                );
              }
            }

            const tas = db
              .prepare(
                'SELECT id, class_id as classId FROM teacher_assignments WHERE subject_id = ? AND academic_year_id = ?'
              )
              .all(shared.id, yr.id) as Array<{ id: number; classId: number }>;
            for (const ta of tas) {
              const newId = remapByOldAndClass.get(`${shared.id}:${ta.classId}`);
              if (newId) {
                db.prepare('UPDATE teacher_assignments SET subject_id = ? WHERE id = ?').run(newId, ta.id);
              }
            }

            const links = db
              .prepare(
                'SELECT id, class_id as classId FROM publish_links WHERE subject_id = ? AND academic_year_id = ?'
              )
              .all(shared.id, yr.id) as Array<{ id: number; classId: number }>;
            for (const lk of links) {
              const newId = remapByOldAndClass.get(`${shared.id}:${lk.classId}`);
              if (newId) {
                db.prepare('UPDATE publish_links SET subject_id = ? WHERE id = ?').run(newId, lk.id);
              }
            }

            // Delete old shared row now that all references are moved to class-specific subjects
            db.prepare('DELETE FROM subjects WHERE id = ?').run(shared.id);
          }
        }

        db.prepare(
          "INSERT INTO settings (key, value) VALUES ('migrated_class_specific_subjects_v1', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
        ).run();
      });
      migrateSubjectsTx();
      db.pragma('foreign_keys = ON');
    }

    // Idempotent migration: enforce ONLY Grade 6 is ministerial (0 for others) and remove الحاسوب from Grade 6
    const migratedRemoveG6Computer = db
      .prepare("SELECT value FROM settings WHERE key = 'migrated_remove_g6_computer_v1'")
      .get();
    if (!migratedRemoveG6Computer) {
      db.pragma('foreign_keys = OFF');
      const g6CleanTx = db.transaction(() => {
        db.exec("UPDATE classes SET is_ministerial = CASE WHEN name LIKE '%السادس%' THEN 1 ELSE 0 END");

        const g6ComputerSubs = db.prepare(`
          SELECT s.id
          FROM subjects s
          JOIN classes c ON c.id = s.class_id
          WHERE c.name LIKE '%السادس%' AND (s.name = 'الحاسوب' OR s.name LIKE '%حاسوب%')
        `).all() as Array<{ id: number }>;

        for (const sub of g6ComputerSubs) {
          db.prepare('DELETE FROM grades WHERE subject_id = ?').run(sub.id);
          db.prepare('DELETE FROM grade6_subject_qualifications WHERE subject_id = ?').run(sub.id);
          db.prepare('DELETE FROM exemptions_subject WHERE subject_id = ?').run(sub.id);
          db.prepare('DELETE FROM grade_objections WHERE subject_id = ?').run(sub.id);
          db.prepare('DELETE FROM teacher_assignments WHERE subject_id = ?').run(sub.id);
          db.prepare('DELETE FROM publish_links WHERE subject_id = ?').run(sub.id);
          db.prepare('DELETE FROM subjects WHERE id = ?').run(sub.id);
        }

        db.prepare(
          "INSERT INTO settings (key, value) VALUES ('migrated_remove_g6_computer_v1', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
        ).run();
      });
      g6CleanTx();
      db.pragma('foreign_keys = ON');
    }

    const artSportsMigrated = db
      .prepare("SELECT value FROM settings WHERE key = 'migrated_art_sports_all_classes_v1'")
      .get() as { value?: string } | undefined;
    if (!artSportsMigrated?.value) {
      const artSportsTx = db.transaction(() => {
        const years = db.prepare('SELECT id FROM academic_years ORDER BY id ASC').all() as Array<{ id: number }>;
        const classes = db.prepare('SELECT id FROM classes ORDER BY display_order ASC, id ASC').all() as Array<{ id: number }>;
        const selectClassSubs = db.prepare(
          'SELECT name, display_order FROM subjects WHERE academic_year_id = ? AND class_id = ? AND is_active = 1'
        );
        const insertSubj = db.prepare(
          'INSERT INTO subjects (academic_year_id, name, max_score, display_order, class_id, section_id, is_active) VALUES (?, ?, 100, ?, ?, NULL, 1)'
        );

        for (const yr of years) {
          for (const cls of classes) {
            const existing = selectClassSubs.all(yr.id, cls.id) as Array<{ name: string; display_order: number }>;
            let maxOrder = existing.reduce((acc, s) => Math.max(acc, Number(s.display_order) || 0), 0);
            const hasArt = existing.some((s) => s.name.includes('فنية'));
            const hasSports = existing.some((s) => s.name.includes('رياضية'));

            if (!hasArt) {
              maxOrder += 1;
              insertSubj.run(yr.id, 'التربية الفنية', maxOrder, cls.id);
            }
            if (!hasSports) {
              maxOrder += 1;
              insertSubj.run(yr.id, 'التربية الرياضية', maxOrder, cls.id);
            }
          }
        }

        db.prepare(
          "INSERT INTO settings (key, value) VALUES ('migrated_art_sports_all_classes_v1', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
        ).run();
      });
      artSportsTx();
    }
    return;
  }

  const seedTx = db.transaction(() => {
    const classNames = [
      ['الرابع العلمي', 1, 0],
      ['الرابع الأدبي', 2, 0],
      ['الخامس العلمي', 3, 0],
      ['الخامس الأدبي', 4, 0],
      ['السادس العلمي', 5, 1],
      ['السادس الأدبي', 6, 1],
    ] as const;

    const insertClass = db.prepare('INSERT INTO classes (name, display_order, is_ministerial) VALUES (?, ?, ?)');
    const insertSection = db.prepare('INSERT INTO sections (academic_year_id, class_id, name, is_active) VALUES (1, ?, ?, 1)');

    const classIds: Record<string, number> = {};
    const sectionIds: Record<string, number> = {};

    for (const [name, order, isMinisterial] of classNames) {
      const info = insertClass.run(name, order, isMinisterial);
      const cid = Number(info.lastInsertRowid);
      classIds[name] = cid;
      for (const secName of ['أ', 'ب']) {
        const sInfo = insertSection.run(cid, secName);
        sectionIds[`${name}::${secName}`] = Number(sInfo.lastInsertRowid);
      }
    }

    const insertSubject = db.prepare(
      'INSERT INTO subjects (academic_year_id, name, max_score, display_order, class_id, section_id, is_active) VALUES (1, ?, 100, ?, ?, NULL, 1)'
    );
    const subjectIdsByClass: Record<string, number[]> = {};
    for (const [clsName] of classNames) {
      const cid = classIds[clsName];
      const curriculum = getDefaultCurriculumForClassName(clsName);
      subjectIdsByClass[clsName] = [];
      curriculum.forEach((subName, idx) => {
        const info = insertSubject.run(subName, idx + 1, cid);
        subjectIdsByClass[clsName].push(Number(info.lastInsertRowid));
      });
    }
    const subjectIds = subjectIdsByClass['السادس العلمي'];

    const examDefs = [
      ['الشهر الأول (الفصل الأول)', 1],
      ['الشهر الثاني (الفصل الأول)', 2],
      ['سعي الفصل الأول', 3],
      ['نصف السنة', 4],
      ['الشهر الأول (الفصل الثاني)', 5],
      ['الشهر الثاني (الفصل الثاني)', 6],
      ['سعي الفصل الثاني', 7],
      ['السعي السنوي', 8],
      ['الامتحان النهائي', 9],
      ['الدرجة النهائية', 10],
      ['الدور الثاني', 11],
    ] as const;

    const insertExam = db.prepare(
      "INSERT INTO exams (name, display_order, is_active, academic_year) VALUES (?, ?, 1, '2025 - 2026')"
    );
    const examIds: Record<string, number> = {};
    for (const [name, order] of examDefs) {
      const info = insertExam.run(name, order);
      examIds[name] = Number(info.lastInsertRowid);
    }

    const sampleStudents = [
      ['حيدر علي حسين الكعبي', '2026101', 'السادس العلمي', 'أ'],
      ['مصطفى كريم جاسم الموسوي', '2026102', 'السادس العلمي', 'أ'],
      ['علي رضا حسن التميمي', '2026103', 'السادس العلمي', 'ب'],
      ['زين العابدين صادق جعفر', '2026104', 'الخامس العلمي', 'أ'],
      ['محمد باقر فاضل العبيدي', '2026105', 'الرابع العلمي', 'أ'],
      ['سجاد طارق عبد الأمير', '2026106', 'السادس الأدبي', 'أ'],
    ] as const;

    const insertStudent = db.prepare(
      'INSERT INTO students (full_name, inquiry_code, class_id, section_id, is_active, notes) VALUES (?, ?, ?, ?, 1, ?)'
    );
    const studentIds: number[] = [];
    for (const [fullName, code, clsName, secName] of sampleStudents) {
      const info = insertStudent.run(
        fullName,
        code,
        classIds[clsName],
        sectionIds[`${clsName}::${secName}`],
        ''
      );
      studentIds.push(Number(info.lastInsertRowid));
    }

    const insertGrade = db.prepare(`
      INSERT INTO grades (student_id, subject_id, exam_id, score, status, notes, updated_by, published_at)
      VALUES (?, ?, ?, ?, ?, ?, 'admin2023', ?)
    `);

    const scoresFirstStudentExam1 = [96, 91, 88, 94, 90, 93, 95, 98];
    const scoresFirstStudentMidterm = [94, 89, 86, 92, 88, 91, 93, 97];
    const scoresSecondStudentExam1 = [84, 79, 82, 88, 76, 81, 85, 90];
    const scoresSecondStudentExam2 = [86, 81, 80, 90, 74, 83, 87, 92];
    const scoresSecondStudentMid = [85, 80, 81, 89, 75, 82, 86, 91];
    const scoresSecondStudentSem2M1 = [87, 83, 84, 91, 78, 84, 88, 93];
    const scoresSecondStudentSem2M2 = [89, 85, 86, 93, 80, 86, 90, 95];

    subjectIds.forEach((subjId, idx) => {
      // Student 1 - الشهر الأول (الفصل الأول) (published)
      insertGrade.run(
        studentIds[0],
        subjId,
        examIds['الشهر الأول (الفصل الأول)'],
        scoresFirstStudentExam1[idx],
        'published',
        idx === 3 ? 'متميز في حل المسائل' : '',
        '2026-02-15 10:30:00'
      );
      // Student 1 - نصف السنة (published - independent)
      insertGrade.run(
        studentIds[0],
        subjId,
        examIds['نصف السنة'],
        scoresFirstStudentMidterm[idx],
        'published',
        '',
        '2026-03-10 09:00:00'
      );
      // Student 1 - الشهر الثاني (الفصل الأول) (draft - MUST NOT appear publicly!)
      insertGrade.run(
        studentIds[0],
        subjId,
        examIds['الشهر الثاني (الفصل الأول)'],
        80 + idx,
        'draft',
        'قيد التدقيق',
        null
      );
      // Student 2 - Complete Semester 1 + Midyear + Semester 2 (published)
      insertGrade.run(
        studentIds[1],
        subjId,
        examIds['الشهر الأول (الفصل الأول)'],
        scoresSecondStudentExam1[idx],
        'published',
        '',
        '2026-02-15 10:30:00'
      );
      insertGrade.run(
        studentIds[1],
        subjId,
        examIds['الشهر الثاني (الفصل الأول)'],
        scoresSecondStudentExam2[idx],
        'published',
        '',
        '2026-03-01 10:00:00'
      );
      insertGrade.run(
        studentIds[1],
        subjId,
        examIds['نصف السنة'],
        scoresSecondStudentMid[idx],
        'published',
        '',
        '2026-03-10 09:00:00'
      );
      insertGrade.run(
        studentIds[1],
        subjId,
        examIds['الشهر الأول (الفصل الثاني)'],
        scoresSecondStudentSem2M1[idx],
        'published',
        '',
        '2026-04-12 10:00:00'
      );
      insertGrade.run(
        studentIds[1],
        subjId,
        examIds['الشهر الثاني (الفصل الثاني)'],
        scoresSecondStudentSem2M2[idx],
        'published',
        '',
        '2026-05-04 10:00:00'
      );
    });

    const insertAnnouncement = db.prepare(`
      INSERT INTO announcements (title, body, publish_date, status, created_by)
      VALUES (?, ?, ?, 'published', 'admin2023')
    `);
    insertAnnouncement.run(
      'إعلان نشر نتائج امتحانات الفصل الأول ونصف السنة',
      'تعلن إدارة إعدادية المنتظر للبنين عن إتاحة الاستعلام الإلكتروني عن نتائج الفصل الأول ونصف السنة للعام الدراسي 2025 - 2026 عبر البوابة باستخدام رقم الهوية الوطنية الخاص بكل طالب.',
      '2026-03-12'
    );

    db.prepare(`
      INSERT INTO admin_notes (title, content, color, pinned, updated_by)
      VALUES (?, ?, 'gold', 1, ?)
    `).run(
      'جدول مراجعة اللجنة الامتحانية',
      'مراجعة كشوف السادس العلمي (شعبة أ و ب) قبل اعتماد نشر درجات الشهر الثاني (الفصل الأول).',
      'admin2023'
    );

    db.prepare(`
      INSERT INTO audit_logs (actor_username, action, entity_type, entity_id, summary)
      VALUES ('admin2023', 'PUBLISH_GRADES', 'exam', '1', 'نشر درجات الشهر الأول (الفصل الأول) المعتمدة لطلبة السادس العلمي')
    `).run();
  });

  seedTx();
}

export function getSettings(db: Database.Database = getDb()): SchoolSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    schoolName: map.schoolName || 'إعدادية المنتظر للبنين',
    republicHeader: map.republicHeader || 'جمهورية العراق',
    ministryHeader: map.ministryHeader || 'وزارة التربية',
    directorate: map.directorate || 'المديرية العامة للتربية',
    academicYear: map.academicYear || '2025 - 2026',
    contactInfo: map.contactInfo || '',
    footerText: map.footerText || '',
    printNote: map.printNote || '',
    emblemUrl: map.emblemUrl || '/assets/aistudio/school_logo_original_f35f0f97.jpg',
    ministrySealUrl: map.ministrySealUrl || '/src/assets/images/ministry_seal_emblem_1795173275872.jpg',
    primaryColor: map.primaryColor || '#0B1F3A',
    accentColor: map.accentColor || '#C59B27',
  };
}

export function recordAuditLog(
  actorUsername: string,
  action: string,
  entityType: string,
  entityId: string | number,
  summary: string
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO audit_logs (actor_username, action, entity_type, entity_id, summary)
    VALUES (?, ?, ?, ?, ?)
  `).run(actorUsername, action, entityType, String(entityId), summary);
}

export const TEACHER_DEFAULT_PERMISSIONS: AdminPermissions = {
  manageStudents: false,
  manageStructure: false,
  manageGrades: true,
  publishGrades: false,
  manageImportExport: true,
  manageAnnouncements: false,
  manageSettings: false,
  manageNotes: false,
};

export function getTeacherAssignments(adminId: number, academicYearId?: number): TeacherAssignment[] {
  const db = getDb();
  if (academicYearId) {
    return db
      .prepare(`
        SELECT ta.id, ta.class_id as classId, c.name as className,
               ta.section_id as sectionId, sec.name as sectionName,
               ta.subject_id as subjectId, sub.name as subjectName
        FROM teacher_assignments ta
        JOIN classes c ON c.id = ta.class_id
        LEFT JOIN sections sec ON sec.id = ta.section_id
        JOIN subjects sub ON sub.id = ta.subject_id
        WHERE ta.admin_id = ? AND ta.academic_year_id = ?
        ORDER BY c.display_order ASC, sub.display_order ASC, ta.id ASC
      `)
      .all(adminId, academicYearId) as TeacherAssignment[];
  }
  return db
    .prepare(`
      SELECT ta.id, ta.class_id as classId, c.name as className,
             ta.section_id as sectionId, sec.name as sectionName,
             ta.subject_id as subjectId, sub.name as subjectName
      FROM teacher_assignments ta
      JOIN classes c ON c.id = ta.class_id
      LEFT JOIN sections sec ON sec.id = ta.section_id
      JOIN subjects sub ON sub.id = ta.subject_id
      WHERE ta.admin_id = ?
      ORDER BY c.display_order ASC, sub.display_order ASC, ta.id ASC
    `)
    .all(adminId) as TeacherAssignment[];
}

export function setTeacherAssignments(
  adminId: number,
  assignments: Array<{ classId: number; sectionId: number | null; subjectId: number }>,
  academicYearId?: number
): void {
  const db = getDb();
  const effectiveYearId = resolveAcademicYearId(academicYearId);
  const seen = new Set<string>();
  const deduped: Array<{ classId: number; sectionId: number | null; subjectId: number }> = [];
  for (const a of assignments) {
    if (!Number.isInteger(a.classId) || !Number.isInteger(a.subjectId)) continue;
    const secId =
      a.sectionId !== null &&
      a.sectionId !== undefined &&
      Number.isInteger(Number(a.sectionId)) &&
      Number(a.sectionId) > 0
        ? Number(a.sectionId)
        : null;
    const key = `${a.classId}:${secId ?? 'all'}:${a.subjectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ classId: a.classId, sectionId: secId, subjectId: a.subjectId });
  }

  const delStmt = db.prepare('DELETE FROM teacher_assignments WHERE admin_id = ? AND academic_year_id = ?');
  const insStmt = db.prepare(
    'INSERT INTO teacher_assignments (academic_year_id, admin_id, class_id, section_id, subject_id) VALUES (?, ?, ?, ?, ?)'
  );
  const tx = db.transaction(() => {
    delStmt.run(adminId, effectiveYearId);
    for (const item of deduped) {
      insStmt.run(effectiveYearId, adminId, item.classId, item.sectionId, item.subjectId);
    }
  });
  tx();
}

export function mapAdminRow(row: Record<string, unknown>, academicYearId?: number): AdminUser {
  const role = row.role as AdminRole;
  let permissions: AdminPermissions =
    role === 'teacher'
      ? { ...TEACHER_DEFAULT_PERMISSIONS }
      : {
          manageStudents: true,
          manageStructure: false,
          manageGrades: true,
          publishGrades: false,
          manageImportExport: true,
          manageAnnouncements: true,
          manageSettings: false,
          manageNotes: true,
        };
  try {
    const parsed = JSON.parse(String(row.permissions_json || '{}')) as Partial<AdminPermissions>;
    if (role === 'teacher') {
      permissions = {
        ...TEACHER_DEFAULT_PERMISSIONS,
        publishGrades: Boolean(parsed.publishGrades),
      };
    } else {
      permissions = { ...permissions, ...parsed };
    }
  } catch {
    // keep defaults
  }
  const id = Number(row.id);
  const assignments = role === 'teacher' ? getTeacherAssignments(id, academicYearId) : [];
  return {
    id,
    username: String(row.username),
    fullName: String(row.full_name),
    role,
    isActive: Boolean(row.is_active),
    googleEmail: row.google_email ? String(row.google_email) : null,
    permissions: role === 'owner' ? OWNER_DEFAULT_PERMISSIONS : permissions,
    assignments,
    createdAt: String(row.created_at),
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
  };
}

let lastAutoBackupAt = 0;

export function createBackupSnapshot(prefix = 'school-backup'): {
  filename: string;
  sizeBytes: number;
  createdAt: string;
} {
  const db = getDb();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${prefix}-${stamp}.db`;
  const destPath = path.join(BACKUPS_DIR, filename);
  db.pragma('wal_checkpoint(FULL)');
  fs.copyFileSync(DB_PATH, destPath);
  const stat = fs.statSync(destPath);
  return {
    filename,
    sizeBytes: stat.size,
    createdAt: new Date().toISOString(),
  };
}

export function triggerAutoBackupSnapshot(force = false): {
  filename: string;
  sizeBytes: number;
  createdAt: string;
} | null {
  const now = Date.now();
  if (!force && now - lastAutoBackupAt < 1000 * 60 * 3) {
    return null;
  }
  try {
    lastAutoBackupAt = now;
    const snap = createBackupSnapshot('auto-backup');
    // Prune older automatic backups beyond 10 to conserve disk
    const autoFiles = fs
      .readdirSync(BACKUPS_DIR)
      .filter((f) => f.startsWith('auto-backup-') && f.endsWith('.db'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const stale of autoFiles.slice(10)) {
      try {
        fs.unlinkSync(path.join(BACKUPS_DIR, stale.name));
      } catch {
        // ignore cleanup failure
      }
    }
    return snap;
  } catch {
    return null;
  }
}

export function restoreFromBackupFile(filename: string): void {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.db') || safeName.includes('..')) {
    throw new Error('اسم ملف النسخة الاحتياطية غير صالح.');
  }
  const sourcePath = path.join(BACKUPS_DIR, safeName);
  if (!fs.existsSync(sourcePath)) {
    throw new Error('ملف النسخة الاحتياطية غير موجود.');
  }

  // Validate SQLite header before closing active DB
  const header = fs.readFileSync(sourcePath).subarray(0, 16).toString('utf8');
  if (!header.startsWith('SQLite format 3')) {
    throw new Error('الملف المحدد ليس قاعدة بيانات SQLite صالحة.');
  }

  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  fs.copyFileSync(sourcePath, DB_PATH);
  // Remove stale WAL/SHM if present
  for (const suffix of ['-wal', '-shm']) {
    const walPath = `${DB_PATH}${suffix}`;
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  }
  getDb();
}

// =============================================================================
// ACADEMIC YEARS & SCOPED QUERIES
// =============================================================================

function mapAcademicYearRow(r: any): AcademicYear {
  return {
    id: Number(r.id),
    name: String(r.name),
    isCurrent: Boolean(r.isCurrent),
    isActive: Boolean(r.isActive),
    grade6MaxFailSubjects: Number(r.grade6MaxFailSubjects ?? 3),
    grade6DecisionBonus: Number(r.grade6DecisionBonus ?? 10),
    exemptionGeneralMinAvg: Number(r.exemptionGeneralMinAvg ?? 75),
    exemptionMinSubject: Number(r.exemptionMinSubject ?? 75),
    exemptionIndividualMin: Number(r.exemptionIndividualMin ?? 90),
    createdAt: String(r.createdAt),
  };
}

export function listAcademicYears(onlyActive = false): AcademicYear[] {
  const sql = onlyActive
    ? `SELECT id, name, is_current as isCurrent, is_active as isActive,
              grade6_max_fail_subjects as grade6MaxFailSubjects,
              grade6_decision_bonus as grade6DecisionBonus,
              exemption_general_min_avg as exemptionGeneralMinAvg,
              exemption_min_subject as exemptionMinSubject,
              exemption_individual_min as exemptionIndividualMin,
              created_at as createdAt
       FROM academic_years
       WHERE is_active = 1
       ORDER BY is_current DESC, id DESC`
    : `SELECT id, name, is_current as isCurrent, is_active as isActive,
              grade6_max_fail_subjects as grade6MaxFailSubjects,
              grade6_decision_bonus as grade6DecisionBonus,
              exemption_general_min_avg as exemptionGeneralMinAvg,
              exemption_min_subject as exemptionMinSubject,
              exemption_individual_min as exemptionIndividualMin,
              created_at as createdAt
       FROM academic_years
       ORDER BY is_current DESC, id DESC`;
  return getDb().prepare(sql).all().map(mapAcademicYearRow);
}

export function getAcademicYearById(id: number): AcademicYear | null {
  const row = getDb()
    .prepare(`
      SELECT id, name, is_current as isCurrent, is_active as isActive,
             grade6_max_fail_subjects as grade6MaxFailSubjects,
             grade6_decision_bonus as grade6DecisionBonus,
             exemption_general_min_avg as exemptionGeneralMinAvg,
             exemption_min_subject as exemptionMinSubject,
             exemption_individual_min as exemptionIndividualMin,
             created_at as createdAt
      FROM academic_years
      WHERE id = ?
    `)
    .get(id);
  return row ? mapAcademicYearRow(row) : null;
}

export function getCurrentAcademicYear(): AcademicYear {
  const db = getDb();
  const row =
    db
      .prepare(`
        SELECT id, name, is_current as isCurrent, is_active as isActive,
               grade6_max_fail_subjects as grade6MaxFailSubjects,
               grade6_decision_bonus as grade6DecisionBonus,
               exemption_general_min_avg as exemptionGeneralMinAvg,
               exemption_min_subject as exemptionMinSubject,
               exemption_individual_min as exemptionIndividualMin,
               created_at as createdAt
        FROM academic_years
        WHERE is_current = 1
        ORDER BY id DESC
        LIMIT 1
      `)
      .get() ??
    db
      .prepare(`
        SELECT id, name, is_current as isCurrent, is_active as isActive,
               grade6_max_fail_subjects as grade6MaxFailSubjects,
               grade6_decision_bonus as grade6DecisionBonus,
               exemption_general_min_avg as exemptionGeneralMinAvg,
               exemption_min_subject as exemptionMinSubject,
               exemption_individual_min as exemptionIndividualMin,
               created_at as createdAt
        FROM academic_years
        ORDER BY id ASC
        LIMIT 1
      `)
      .get();
  if (!row) {
    return {
      id: 1,
      name: '2025 - 2026',
      isCurrent: true,
      isActive: true,
      grade6MaxFailSubjects: 3,
      grade6DecisionBonus: 10,
      exemptionGeneralMinAvg: 75,
      exemptionMinSubject: 75,
      exemptionIndividualMin: 90,
      createdAt: new Date().toISOString(),
    };
  }
  return mapAcademicYearRow(row);
}

export function resolveAcademicYearId(requestedYearId?: unknown): number {
  const parsed = Number(requestedYearId);
  if (Number.isInteger(parsed) && parsed > 0) {
    const found = getAcademicYearById(parsed);
    if (found) return found.id;
  }
  return getCurrentAcademicYear().id;
}

export function listClasses(): SchoolClass[] {
  return getDb()
    .prepare(
      'SELECT id, name, display_order as displayOrder, is_ministerial as isMinisterial, created_at as createdAt FROM classes ORDER BY display_order ASC, id ASC'
    )
    .all()
    .map((r: any) => ({ ...r, isMinisterial: Boolean(r.isMinisterial) }));
}

export function listSections(academicYearId?: number): Section[] {
  const db = getDb();
  const where = academicYearId ? 'WHERE s.academic_year_id = ?' : '';
  const params = academicYearId ? [academicYearId] : [];
  return db
    .prepare(`
      SELECT s.id, s.academic_year_id as academicYearId, s.class_id as classId, c.name as className,
             s.name, s.is_active as isActive, s.created_at as createdAt
      FROM sections s
      JOIN classes c ON c.id = s.class_id
      ${where}
      ORDER BY c.display_order ASC, s.name ASC
    `)
    .all(...params)
    .map((r: any) => ({ ...r, isActive: Boolean(r.isActive) }));
}

export function listSubjects(academicYearId?: number): Subject[] {
  const db = getDb();
  const where = academicYearId ? 'WHERE sub.academic_year_id = ?' : '';
  const params = academicYearId ? [academicYearId] : [];
  return db
    .prepare(`
      SELECT sub.id, sub.academic_year_id as academicYearId, sub.name, sub.max_score as maxScore,
             sub.display_order as displayOrder, sub.class_id as classId, sub.section_id as sectionId,
             c.name as className, sec.name as sectionName, sub.is_active as isActive
      FROM subjects sub
      LEFT JOIN classes c ON c.id = sub.class_id
      LEFT JOIN sections sec ON sec.id = sub.section_id
      ${where}
      ORDER BY COALESCE(c.display_order, 999) ASC, sub.display_order ASC, sub.id ASC
    `)
    .all(...params)
    .map((r: any) => ({ ...r, isActive: Boolean(r.isActive) }));
}

export function listExams(academicYearId?: number): Exam[] {
  const db = getDb();
  const where = academicYearId ? 'WHERE academic_year_id = ?' : '';
  const params = academicYearId ? [academicYearId] : [];
  return db
    .prepare(`
      SELECT id, academic_year_id as academicYearId, name, display_order as displayOrder,
             is_active as isActive, academic_year as academicYear, created_at as createdAt
      FROM exams
      ${where}
      ORDER BY display_order ASC, id ASC
    `)
    .all(...params)
    .map((r: any) => ({ ...r, isActive: Boolean(r.isActive) }));
}

export function listStudents(academicYearId?: number): Student[] {
  const db = getDb();
  const where = academicYearId ? 'WHERE st.academic_year_id = ?' : '';
  const params = academicYearId ? [academicYearId] : [];
  const rows = db
    .prepare(`
      SELECT st.id, st.academic_year_id as academicYearId, st.full_name as fullName, st.inquiry_code as inquiryCode,
             st.class_id as classId, st.section_id as sectionId,
             c.name as className, sec.name as sectionName,
             st.is_active as isActive, st.notes, st.created_at as createdAt, st.updated_at as updatedAt
      FROM students st
      JOIN classes c ON c.id = st.class_id
      JOIN sections sec ON sec.id = st.section_id
      ${where}
    `)
    .all(...params)
    .map((r: any) => ({ ...r, isActive: Boolean(r.isActive) })) as Student[];

  return rows.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar', { sensitivity: 'base' }));
}

export function listAnnouncements(onlyPublished = false): Announcement[] {
  const sql = onlyPublished
    ? `SELECT id, title, body, publish_date as publishDate, status, created_by as createdBy, created_at as createdAt
       FROM announcements WHERE status = 'published' ORDER BY publish_date DESC, id DESC`
    : `SELECT id, title, body, publish_date as publishDate, status, created_by as createdBy, created_at as createdAt
       FROM announcements ORDER BY publish_date DESC, id DESC`;
  return getDb().prepare(sql).all() as Announcement[];
}

export function listGrades(academicYearId?: number): GradeRecord[] {
  const db = getDb();
  const where = academicYearId ? 'WHERE academic_year_id = ?' : '';
  const params = academicYearId ? [academicYearId] : [];
  return db
    .prepare(`
      SELECT id, academic_year_id as academicYearId, student_id as studentId, subject_id as subjectId, exam_id as examId,
             score, status, notes, updated_by as updatedBy, updated_at as updatedAt, published_at as publishedAt
      FROM grades
      ${where}
    `)
    .all(...params) as GradeRecord[];
}

export function listGrade6SubjectQualifications(
  academicYearId: number,
  studentId?: number
): Grade6SubjectQualification[] {
  const db = getDb();
  const sql = studentId
    ? `SELECT id, academic_year_id as academicYearId, student_id as studentId, subject_id as subjectId,
              decision, decision_source as decisionSource, bonus_applied as bonusApplied,
              status, notes, updated_by as updatedBy, updated_at as updatedAt, published_at as publishedAt
       FROM grade6_subject_qualifications
       WHERE academic_year_id = ? AND student_id = ?`
    : `SELECT id, academic_year_id as academicYearId, student_id as studentId, subject_id as subjectId,
              decision, decision_source as decisionSource, bonus_applied as bonusApplied,
              status, notes, updated_by as updatedBy, updated_at as updatedAt, published_at as publishedAt
       FROM grade6_subject_qualifications
       WHERE academic_year_id = ?`;
  const rows = studentId ? db.prepare(sql).all(academicYearId, studentId) : db.prepare(sql).all(academicYearId);
  return rows.map((r: any) => ({
    ...r,
    decision: (r.decision as MinisterialDecision | null) ?? null,
    bonusApplied: Number(r.bonusApplied ?? 0),
  }));
}

export function listGrade6OverallQualifications(
  academicYearId: number,
  studentId?: number
): Grade6OverallQualification[] {
  const db = getDb();
  const sql = studentId
    ? `SELECT id, academic_year_id as academicYearId, student_id as studentId,
              decision, decision_source as decisionSource, bonus_used as bonusUsed,
              max_fail_subjects as maxFailSubjects, decision_bonus_limit as decisionBonusLimit,
              status, notes, updated_by as updatedBy, updated_at as updatedAt, published_at as publishedAt
       FROM grade6_overall_qualifications
       WHERE academic_year_id = ? AND student_id = ?`
    : `SELECT id, academic_year_id as academicYearId, student_id as studentId,
              decision, decision_source as decisionSource, bonus_used as bonusUsed,
              max_fail_subjects as maxFailSubjects, decision_bonus_limit as decisionBonusLimit,
              status, notes, updated_by as updatedBy, updated_at as updatedAt, published_at as publishedAt
       FROM grade6_overall_qualifications
       WHERE academic_year_id = ?`;
  const rows = studentId ? db.prepare(sql).all(academicYearId, studentId) : db.prepare(sql).all(academicYearId);
  return rows.map((r: any) => ({
    ...r,
    decision: (r.decision as MinisterialDecision | null) ?? null,
    bonusUsed: Number(r.bonusUsed ?? 0),
    maxFailSubjects: Number(r.maxFailSubjects ?? 3),
    decisionBonusLimit: Number(r.decisionBonusLimit ?? 10),
  }));
}

export function listAuditLogs(limit = 30): AuditLog[] {
  return getDb()
    .prepare(`
      SELECT id, actor_username as actorUsername, action, entity_type as entityType,
             entity_id as entityId, summary, created_at as createdAt
      FROM audit_logs ORDER BY id DESC LIMIT ?
    `)
    .all(limit) as AuditLog[];
}

export function listAdminNotes(): AdminNote[] {
  return getDb()
    .prepare(`
      SELECT id, title, content, color, pinned, updated_by as updatedBy, updated_at as updatedAt
      FROM admin_notes ORDER BY pinned DESC, id DESC
    `)
    .all()
    .map((r: any) => ({ ...r, pinned: Boolean(r.pinned) }));
}

function queryPublishLinksWhere(whereSql = '', params: unknown[] = []): PublishLink[] {
  return getDb()
    .prepare(`
      SELECT pl.id, pl.academic_year_id as academicYearId, pl.slug, pl.title,
             pl.class_id as classId, c.name as className,
             pl.section_id as sectionId, sec.name as sectionName,
             pl.subject_id as subjectId, sub.name as subjectName,
             pl.exam_id as examId, e.name as examName,
             pl.created_by as createdBy, pl.created_at as createdAt
      FROM publish_links pl
      JOIN classes c ON c.id = pl.class_id
      LEFT JOIN sections sec ON sec.id = pl.section_id
      LEFT JOIN subjects sub ON sub.id = pl.subject_id
      JOIN exams e ON e.id = pl.exam_id
      ${whereSql}
      ORDER BY pl.id DESC
    `)
    .all(...params) as PublishLink[];
}

export function listPublishLinks(limit = 30, academicYearId?: number): PublishLink[] {
  if (academicYearId) {
    return queryPublishLinksWhere('WHERE pl.academic_year_id = ?', [academicYearId]).slice(0, limit);
  }
  return queryPublishLinksWhere('', []).slice(0, limit);
}

export function getPublishLinkBySlug(slug: string): PublishLink | null {
  const rows = queryPublishLinksWhere('WHERE pl.slug = ?', [slug.trim()]);
  return rows[0] ?? null;
}

export function deletePublishLink(id: number): boolean {
  const info = getDb().prepare('DELETE FROM publish_links WHERE id = ?').run(id);
  return info.changes > 0;
}

export function ensurePublishLink(params: {
  academicYearId?: number;
  classId: number;
  sectionId: number | null;
  subjectId: number | null;
  examId: number;
  createdBy: string;
}): PublishLink | null {
  const db = getDb();
  const effectiveYearId = resolveAcademicYearId(params.academicYearId);
  const cls = db.prepare('SELECT id, name FROM classes WHERE id = ?').get(params.classId) as
    | { id: number; name: string }
    | undefined;
  const exam = db.prepare('SELECT id, name FROM exams WHERE id = ?').get(params.examId) as
    | { id: number; name: string }
    | undefined;
  if (!cls || !exam) return null;

  const sec = params.sectionId
    ? (db.prepare('SELECT id, name FROM sections WHERE id = ?').get(params.sectionId) as
        | { id: number; name: string }
        | undefined)
    : undefined;
  const sub = params.subjectId
    ? (db.prepare('SELECT id, name FROM subjects WHERE id = ?').get(params.subjectId) as
        | { id: number; name: string }
        | undefined)
    : undefined;

  const sectionLabel = sec ? `شعبة ${sec.name}` : 'جميع الشعب';
  const subjectLabel = sub ? `مادة ${sub.name}` : 'جميع المواد الدراسية';
  const title = `نتائج ${subjectLabel} — ${exam.name} — ${cls.name} (${sectionLabel})`;

  const existing = db
    .prepare(
      `SELECT slug FROM publish_links
       WHERE academic_year_id = ?
         AND class_id = ?
         AND ((? IS NULL AND section_id IS NULL) OR section_id = ?)
         AND ((? IS NULL AND subject_id IS NULL) OR subject_id = ?)
         AND exam_id = ?
       LIMIT 1`
    )
    .get(
      effectiveYearId,
      params.classId,
      params.sectionId,
      params.sectionId,
      params.subjectId,
      params.subjectId,
      params.examId
    ) as { slug: string } | undefined;

  if (existing) {
    db.prepare(
      "UPDATE publish_links SET title = ?, created_by = ?, created_at = datetime('now') WHERE slug = ?"
    ).run(title, params.createdBy, existing.slug);
    return getPublishLinkBySlug(existing.slug);
  }

  const slug = `n${crypto.randomBytes(4).toString('hex')}`;
  db.prepare(
    `INSERT INTO publish_links (academic_year_id, slug, title, class_id, section_id, subject_id, exam_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    effectiveYearId,
    slug,
    title,
    params.classId,
    params.sectionId,
    params.subjectId,
    params.examId,
    params.createdBy
  );

  return getPublishLinkBySlug(slug);
}

export function listSubjectExemptions(
  academicYearId: number,
  studentId?: number
): SubjectExemption[] {
  const db = getDb();
  const sql = studentId
    ? `SELECT id, academic_year_id as academicYearId, student_id as studentId, subject_id as subjectId,
              decision, exemption_type as exemptionType, decision_source as decisionSource,
              status, notes, updated_by as updatedBy, updated_at as updatedAt, published_at as publishedAt
       FROM exemptions_subject
       WHERE academic_year_id = ? AND student_id = ?`
    : `SELECT id, academic_year_id as academicYearId, student_id as studentId, subject_id as subjectId,
              decision, exemption_type as exemptionType, decision_source as decisionSource,
              status, notes, updated_by as updatedBy, updated_at as updatedAt, published_at as publishedAt
       FROM exemptions_subject
       WHERE academic_year_id = ?`;
  const rows = studentId ? db.prepare(sql).all(academicYearId, studentId) : db.prepare(sql).all(academicYearId);
  return rows.map((r: any) => ({
    ...r,
    decision: (r.decision as ExemptionDecision | null) ?? null,
    exemptionType: r.exemptionType === 'general' ? 'general' : 'individual',
  }));
}

export function listOverallExemptions(
  academicYearId: number,
  studentId?: number
): OverallExemption[] {
  const db = getDb();
  const sql = studentId
    ? `SELECT id, academic_year_id as academicYearId, student_id as studentId,
              decision, annual_average as annualAverage, decision_source as decisionSource,
              status, notes, updated_by as updatedBy, updated_at as updatedAt, published_at as publishedAt
       FROM exemptions_overall
       WHERE academic_year_id = ? AND student_id = ?`
    : `SELECT id, academic_year_id as academicYearId, student_id as studentId,
              decision, annual_average as annualAverage, decision_source as decisionSource,
              status, notes, updated_by as updatedBy, updated_at as updatedAt, published_at as publishedAt
       FROM exemptions_overall
       WHERE academic_year_id = ?`;
  const rows = studentId ? db.prepare(sql).all(academicYearId, studentId) : db.prepare(sql).all(academicYearId);
  return rows.map((r: any) => ({
    ...r,
    decision: (r.decision as ExemptionDecision | null) ?? null,
    annualAverage: r.annualAverage !== null && r.annualAverage !== undefined ? Number(r.annualAverage) : null,
  }));
}

export function listGradeObjections(academicYearId?: number): GradeObjection[] {
  const db = getDb();
  const where = academicYearId ? 'WHERE o.academic_year_id = ?' : '';
  const params = academicYearId ? [academicYearId] : [];
  return db
    .prepare(`
      SELECT o.id, o.academic_year_id as academicYearId, o.student_id as studentId,
             st.full_name as studentName, st.inquiry_code as inquiryCode,
             st.class_id as classId, c.name as className, sec.name as sectionName,
             o.subject_id as subjectId, sub.name as subjectName,
             o.exam_id as examId, ex.name as examName,
             o.recorded_score as recordedScore, o.reason, o.status,
             o.corrected_score as correctedScore, o.admin_note as adminNote,
             o.is_published as isPublished, o.created_at as createdAt,
             o.resolved_at as resolvedAt, o.resolved_by as resolvedBy
      FROM grade_objections o
      JOIN students st ON st.id = o.student_id
      JOIN classes c ON c.id = st.class_id
      JOIN sections sec ON sec.id = st.section_id
      JOIN subjects sub ON sub.id = o.subject_id
      JOIN exams ex ON ex.id = o.exam_id
      ${where}
      ORDER BY CASE WHEN o.status = 'pending' THEN 0 ELSE 1 END ASC, o.id DESC
    `)
    .all(...params)
    .map((r: any) => ({
      ...r,
      recordedScore: r.recordedScore !== null && r.recordedScore !== undefined ? Number(r.recordedScore) : null,
      correctedScore: r.correctedScore !== null && r.correctedScore !== undefined ? Number(r.correctedScore) : null,
      isPublished: Boolean(r.isPublished),
    })) as GradeObjection[];
}

export function listPublicObjectionNotices(
  academicYearId: number,
  studentId: number
): PublicObjectionNoticeItem[] {
  return getDb()
    .prepare(`
      SELECT o.id, o.subject_id as subjectId, sub.name as subjectName,
             o.exam_id as examId, ex.name as examName,
             o.status, o.recorded_score as recordedScore,
             o.corrected_score as correctedScore, o.admin_note as adminNote,
             o.resolved_at as resolvedAt
      FROM grade_objections o
      JOIN subjects sub ON sub.id = o.subject_id
      JOIN exams ex ON ex.id = o.exam_id
      WHERE o.academic_year_id = ?
        AND o.student_id = ?
        AND o.is_published = 1
        AND o.status IN ('matching','mismatching')
      ORDER BY o.id DESC
    `)
    .all(academicYearId, studentId)
    .map((r: any) => ({
      ...r,
      recordedScore: r.recordedScore !== null && r.recordedScore !== undefined ? Number(r.recordedScore) : null,
      correctedScore: r.correctedScore !== null && r.correctedScore !== undefined ? Number(r.correctedScore) : null,
    })) as PublicObjectionNoticeItem[];
}


