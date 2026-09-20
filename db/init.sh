#!/usr/bin/env bash
set -euo pipefail

URI="${NEO4J_URI:-bolt://neo4j:7687}"
USER="${NEO4J_USER:-neo4j}"
PASS="${NEO4J_PASSWORD}"

shell() {
  cypher-shell -a "$URI" -u "$USER" -p "$PASS" "$@"
}

# Returns the single scalar from a query, stripped of header and quotes.
scalar() {
  shell --format plain "$1" | tail -n1 | tr -d '"'
}

echo "==> waiting for neo4j at $URI"
for i in $(seq 1 60); do
  if shell "RETURN 1" >/dev/null 2>&1; then break; fi
  sleep 2
  if [ "$i" = 60 ]; then echo "!! timed out"; exit 1; fi
done

echo "==> applying schema"
shell -f /db/schema.cypher

# --- migrations -------------------------------------------------------
# Each file under migrations/ runs exactly once, in filename order.
# Applied files are recorded as (:_Migration {name}).

shell "CREATE CONSTRAINT migration_name IF NOT EXISTS
       FOR (m:_Migration) REQUIRE m.name IS UNIQUE" >/dev/null

shopt -s nullglob
for f in /db/migrations/*.cypher; do
  name="$(basename "$f")"
  applied="$(scalar "MATCH (m:_Migration {name:'$name'}) RETURN count(m)")"

  if [ "$applied" = "0" ]; then
    echo "==> migration: $name"
    shell -f "$f"
    shell "MERGE (m:_Migration {name:'$name'})
           ON CREATE SET m.applied = datetime()" >/dev/null
  else
    echo "    migration: $name (already applied)"
  fi
done

# --- optional seed ----------------------------------------------------
# Only on an empty graph, so it can never clobber real data.

if [ "${SEED:-0}" = "1" ]; then
  count="$(scalar "MATCH (n:Entity) RETURN count(n)")"
  if [ "$count" = "0" ]; then
    echo "==> seeding sample data"
    shell -f /db/seed.cypher
  else
    echo "    seed skipped ($count entities already present)"
  fi
fi

# --- report -----------------------------------------------------------

echo
echo "==> ready"
shell --format plain "
MATCH (n:Entity)       WITH count(n) AS entities
MATCH ()-[r]->()       WHERE NOT type(r) STARTS WITH '_'
WITH entities, count(r) AS rels
MATCH (t:_EntityType)  WITH entities, rels, count(t) AS etypes
MATCH (t:_RelType)     RETURN entities, rels, etypes, count(t) AS rtypes"
