# V2.13.1 — correctif taxis ASCT

Le parseur ASCT a été renforcé :
- intervalles TAXI dont les deux minutes sont imprimées sur la même ligne ;
- zone de recherche des gares élargie autour du segment TAXI ;
- correspondance par code gare (LNS, LE, SPT) en plus du nom SNCF ;
- une date spécifique `LE jj/mm` est prioritaire sur la règle hebdomadaire ;
- le statut affiche aussi combien de taxis ASCT sont actifs sur la date choisie.

La base ASCT est reconstruite depuis le roulement de 55 pages.
