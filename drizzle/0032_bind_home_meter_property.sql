-- Smart-home meter writes used to select an arbitrary lived-in property.
-- Bind existing configurations once to the oldest lived-in property so later
-- writes remain deterministic; new configurations require an explicit choice.
update settings as home
set value = jsonb_set(
	home.value,
	'{meterPropertyId}',
	to_jsonb(chosen.id),
	true
)
from lateral (
	select id
	from property
	where kind = 'lived'
	order by created_at, id
	limit 1
) as chosen
where home.key = 'home'
	and jsonb_typeof(home.value) = 'object'
	and coalesce(home.value ->> 'kind', '') <> ''
	and coalesce(home.value ->> 'meterPropertyId', '') = '';
