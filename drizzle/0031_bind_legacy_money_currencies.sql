-- Monetary configuration written before its currency was stored beside it
-- was authored in the household base currency that existed at this upgrade.
-- Bind that provenance once; reading it against a later base currency would
-- silently redenominate the same minor-unit number.
with configured_base as (
	select coalesce(
		(select value #>> '{}' from settings where key = 'baseCurrency'),
		'CZK'
	) as code
)
update rule as r
set conditions = (
	select jsonb_agg(
		case
			when item.value ->> 'field' = 'amount'
				and coalesce(item.value ->> 'currency', '') = ''
			then item.value || jsonb_build_object('currency', configured_base.code)
			else item.value
		end
		order by item.ordinality
	) as conditions
	from jsonb_array_elements(r.conditions) with ordinality as item(value, ordinality)
)
from configured_base
where jsonb_typeof(r.conditions) = 'array'
	and exists (
		select 1
		from jsonb_array_elements(r.conditions) as item(value)
		where item.value ->> 'field' = 'amount'
			and coalesce(item.value ->> 'currency', '') = ''
	);
--> statement-breakpoint

with configured_base as (
	select coalesce(
		(select value #>> '{}' from settings where key = 'baseCurrency'),
		'CZK'
	) as code
)
update settings as home
set value = jsonb_set(
	home.value,
	'{pricePerKwhCurrency}',
	to_jsonb(configured_base.code),
	true
)
from configured_base
where home.key = 'home'
	and jsonb_typeof(home.value) = 'object'
	and coalesce(home.value ->> 'pricePerKwh', '') <> ''
	and coalesce(home.value ->> 'pricePerKwhCurrency', '') = '';
