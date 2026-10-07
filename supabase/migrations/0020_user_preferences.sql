alter table students
  add column preferred_name text not null default '' check (char_length(preferred_name) <= 80),
  add column voice_name text not null default 'marin' check (voice_name in ('marin', 'quartz', 'ripple', 'vesper', 'willow', 'stone', 'gleam', 'meridian', 'bossa', 'tempo', 'beacon', 'delta', 'cinder')),
  add column response_length text not null default 'balanced' check (response_length in ('concise', 'balanced', 'detailed')),
  add column live_captions boolean not null default true;
