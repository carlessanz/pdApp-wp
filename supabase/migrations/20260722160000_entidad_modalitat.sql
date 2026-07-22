-- Modalitat d'aprofitament de la entitat receptora.
--
-- Indica com aprofita l'entitat els excedents: donació, transformació, venda,
-- maquila… No hi havia cap camp per a això. Text lliure a nivell de BD (el
-- desplegable del panell ofereix els valors estàndard); nullable perquè les 111
-- entitats importades no el porten.

alter table entidades add column if not exists modalitat text;
