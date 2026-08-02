# The Capitalist / Monopoly Club - board reference

Source: Wayback en.monopoly-club.com HTML 2024-01-11 (gzip decompressed).

## Rules highlights
* Players: 2-5
* Start capital: $1,500,000
* Turn limit: 2 minutes (timeout = bankrupt)
* Tax field: 6% of current capital
* Special fields: Start, Chance, Force Majeure, Customs, Tax, Offshore, Customs Clearance
* Board has 38 playable fields (field1-field38) in HTML
* Per-field buy prices/rents are NOT in static HTML; server-driven and painted onto board.png / .fieldPrice at runtime.

## Special field labels
* START: Start
* CHANCE: Chance
* FORCE_MAJEURE: Force Majeure
* CUSTOMS: Customs
* TAX: Tax
* OFFSHORE: Offshore
* GO_TO_CUSTOMS: Customs Clearance

## Companies (from LOCALIZED_FIELD_DESCRIPTION_*)
1. ROLLS_ROYCE
2. MACDONALDS
3. BP
4. BBC
5. SAMSUNG
6. DANONE
7. HENNESSY
8. DISNEY
9. LOREAL
10. IKEA
11. VOLVO
12. ARMANI
13. VERSACE
14. FERRARI
15. SONY
16. COCA
17. CANON
18. TOYOTA
19. HYUNDAI
20. SIEMENS
21. ADIDAS
22. FORD
23. MERCEDES
24. ALIBABA
25. LENOVO
26. HUAWEI
27. XIAOMI
28. NESTLE
29. ROLEX

## HTML board skeleton
See docs/board-fields.csv. Share country CSS classes: usa, ko. Logos/flags are .logo/.flag overlays on board art.
