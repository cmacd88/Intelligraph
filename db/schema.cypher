// ============================================================
// Constraints
// ============================================================

CREATE CONSTRAINT entity_uid IF NOT EXISTS
FOR (n:Entity) REQUIRE n.uid IS UNIQUE;

CREATE CONSTRAINT entity_type_name IF NOT EXISTS
FOR (t:_EntityType) REQUIRE t.name IS UNIQUE;

CREATE CONSTRAINT rel_type_name IF NOT EXISTS
FOR (t:_RelType) REQUIRE t.name IS UNIQUE;

CREATE CONSTRAINT source_uid IF NOT EXISTS
FOR (s:_Source) REQUIRE s.uid IS UNIQUE;

// ============================================================
// Indexes
// ============================================================

CREATE INDEX entity_name IF NOT EXISTS
FOR (n:Entity) ON (n.name);

CREATE INDEX entity_type IF NOT EXISTS
FOR (n:Entity) ON (n.type);

CREATE INDEX entity_updated IF NOT EXISTS
FOR (n:Entity) ON (n.updated);

// Substring and fuzzy search. A CONTAINS scan reads every node and
// degrades badly past a few thousand; this does not.
CREATE FULLTEXT INDEX entity_search IF NOT EXISTS
FOR (n:Entity) ON EACH [n.name, n.notes];

// ============================================================
// Entity types
// ============================================================
// ON CREATE only, so hand-edited colours in a live database survive
// a re-run of this file.

MERGE (t:_EntityType {name:'Person'})
  ON CREATE SET t.color='#3b82f6', t.glyph='PE', t.builtin=true;
MERGE (t:_EntityType {name:'Company'})
  ON CREATE SET t.color='#8b5cf6', t.glyph='CO', t.builtin=true;
MERGE (t:_EntityType {name:'Domain'})
  ON CREATE SET t.color='#10b981', t.glyph='DO', t.builtin=true;
MERGE (t:_EntityType {name:'IP'})
  ON CREATE SET t.color='#f59e0b', t.glyph='IP', t.builtin=true;
MERGE (t:_EntityType {name:'Email'})
  ON CREATE SET t.color='#ef4444', t.glyph='EM', t.builtin=true;
MERGE (t:_EntityType {name:'Phone'})
  ON CREATE SET t.color='#06b6d4', t.glyph='PH', t.builtin=true;
MERGE (t:_EntityType {name:'Device'})
  ON CREATE SET t.color='#ec4899', t.glyph='DV', t.builtin=true;
MERGE (t:_EntityType {name:'Location'})
  ON CREATE SET t.color='#14b8a6', t.glyph='LO', t.builtin=true;
MERGE (t:_EntityType {name:'Account'})
  ON CREATE SET t.color='#a855f7', t.glyph='AC', t.builtin=true;
MERGE (t:_EntityType {name:'Document'})
  ON CREATE SET t.color='#64748b', t.glyph='DC', t.builtin=true;
MERGE (t:_EntityType {name:'Event'})
  ON CREATE SET t.color='#f97316', t.glyph='EV', t.builtin=true;
MERGE (t:_EntityType {name:'Organization'})
  ON CREATE SET t.color='#6366f1', t.glyph='OR', t.builtin=true;

// ============================================================
// Relationship types
// ============================================================
// directed=false: the UI draws no arrowhead and treats a->b and b->a
// as the same claim.

MERGE (t:_RelType {name:'CONNECTS_TO'})
  ON CREATE SET t.directed=false, t.builtin=true;
MERGE (t:_RelType {name:'KNOWS'})
  ON CREATE SET t.directed=false, t.builtin=true;
MERGE (t:_RelType {name:'SEEN_WITH'})
  ON CREATE SET t.directed=false, t.builtin=true;
MERGE (t:_RelType {name:'SAME_AS'})
  ON CREATE SET t.directed=false, t.builtin=true;
MERGE (t:_RelType {name:'RELATED_TO'})
  ON CREATE SET t.directed=false, t.builtin=true;

MERGE (t:_RelType {name:'WORKS_AT'})
  ON CREATE SET t.directed=true, t.builtin=true;
MERGE (t:_RelType {name:'OWNS'})
  ON CREATE SET t.directed=true, t.builtin=true;
MERGE (t:_RelType {name:'MANAGES'})
  ON CREATE SET t.directed=true, t.builtin=true;
MERGE (t:_RelType {name:'USES'})
  ON CREATE SET t.directed=true, t.builtin=true;
MERGE (t:_RelType {name:'CONTROLS'})
  ON CREATE SET t.directed=true, t.builtin=true;
MERGE (t:_RelType {name:'MEMBER_OF'})
  ON CREATE SET t.directed=true, t.builtin=true;
MERGE (t:_RelType {name:'RESOLVES_TO'})
  ON CREATE SET t.directed=true, t.builtin=true;
MERGE (t:_RelType {name:'LOCATED_AT'})
  ON CREATE SET t.directed=true, t.builtin=true;
MERGE (t:_RelType {name:'PAID'})
  ON CREATE SET t.directed=true, t.builtin=true;
MERGE (t:_RelType {name:'MENTIONED_IN'})
  ON CREATE SET t.directed=true, t.builtin=true;
MERGE (t:_RelType {name:'REGISTERED_BY'})
  ON CREATE SET t.directed=true, t.builtin=true;
