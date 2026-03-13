CREATE TABLE IF NOT EXISTS court_events (
  id SERIAL PRIMARY KEY,
  court_type VARCHAR(50),
  court_name VARCHAR(255),
  court_room VARCHAR(100),
  event_date DATE,
  event_time VARCHAR(20),
  hearing_type VARCHAR(255),
  case_number VARCHAR(255),
  case_type VARCHAR(255),
  defendant_name VARCHAR(255),
  defendant_otn VARCHAR(255),
  defendant_dob DATE,
  citation_number VARCHAR(255),
  sheriff_number VARCHAR(255),
  lea_number VARCHAR(255),
  prosecuting_attorney VARCHAR(255),
  defense_attorney VARCHAR(255),
  source_pdf_url TEXT,
  source_page_number INTEGER,
  content_hash VARCHAR(64),
  scraped_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_court_events_case_number ON court_events(case_number);
CREATE INDEX IF NOT EXISTS idx_court_events_defendant ON court_events(defendant_name);
CREATE INDEX IF NOT EXISTS idx_court_events_court_name ON court_events(court_name);
CREATE INDEX IF NOT EXISTS idx_court_events_date ON court_events(event_date);
CREATE INDEX IF NOT EXISTS idx_court_events_otn ON court_events(defendant_otn);
CREATE INDEX IF NOT EXISTS idx_court_events_citation ON court_events(citation_number);
CREATE INDEX IF NOT EXISTS idx_court_events_hash ON court_events(content_hash);
