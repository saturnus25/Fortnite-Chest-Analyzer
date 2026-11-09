# Investigación del formato y validación

## Validación con repeticiones reales

El archivo contenía 100 repeticiones con GUID distintos, grabadas entre el 6 y el 8 de noviembre de 2026. Todas usan `++Fortnite+Release-43.00`, build 59594394, contenedor 7, cabecera de red 19 y protocolo del motor 45. El lector obtuvo 99 análisis completos y 1 grabación sin un flujo de activaciones reconocible. En este informe, «completo» indica que el lector pudo recorrer el flujo pertinente. Una repetición local solo muestra los actores y cambios que el cliente recibió y grabó.

| Observación en el lote | Resultado |
| --- | ---: |
| Activaciones observadas con evidencia, de todos los equipos | 11.138 |
| Aperturas de cofres de clase identificada, de todos los equipos | 7.302 |
| Aperturas de cofres de clase identificada, del grabador y su escuadrón | 3.341 |
| Entregas de suministros observadas | 431 |
| Entregas observadas abiertas, con o sin hora de apertura | 41 |
| Aperturas de entregas con transición observada | 40 |
| Actores de artilugios de la rueda en 23 partidas | 32 |
| Extractores portátiles consumibles observados como objetos en el suelo | 221 |
| Extractores consumibles con origen vinculado | 75 |
| Aperturas de cajas de munición | 263 |
| Aperturas de cofres de espíritu, clases `B_SpritePosters_Booty_Chest*` | 15 |
| Disparos de cañones de botín | 281 |
| Actores de objetos vinculados por `Owner` y `bTossedFromContainer` | 22.497 |
| Actores de objetos vinculados por `SpawnedPickupLoot` | 557 |
| Aperturas atribuidas al grabador o a su escuadrón | 3.410 |
| Rupturas atribuidas al grabador o a su escuadrón | 2.250 |
| Objetos vinculados a activaciones atribuidas al escuadrón | 16.839 |

En las 99 repeticiones con resultados de activación se reconstruyó el equipo a partir del estado del grabador. El corpus completo incluye 98 rosters de cuatro integrantes, uno de tres y una grabación sin flujo de activaciones reconocido que solo mostró al grabador. Se observaron nombres visibles en 396 registros de integrante. Una misma huella de cuenta aparece con dos nombres en partidas distintas. Estos números describen la cobertura del lector sobre el corpus y pueden diferir del total real de una partida.

## Evidencia por tipo de dato

| Campo | Evidencia utilizada y límites |
| --- | --- |
| Apertura | `bAlreadySearched` y `SearchAnimationCount` en clases de contenedores. Se exige una observación anterior o un `SearchingPawn` replicado para contar el estado. Un actor recibido ya abierto sin evidencia de transición queda fuera del recuento. |
| Tipos de contenedor | La clasificación utiliza la clase interna exacta, conservada en la tabla junto a su etiqueta. Las clases nuevas quedan sin clasificar hasta verificar su identidad. La métrica de cofres cuenta aperturas de cofres identificados. |
| Entregas de suministros | Se observaron 298 actores de clase `AthenaSupplyDrop_PoolDust` y 133 de `AthenaSupplyDrop_Vault`. `Opened` marca el estado. La hora se registra si la transición es visible. `LandingLocation` aporta posición y `bHasSpawnedPickups` aporta estado cuando está presente. Las 40 aperturas con hora carecen de un jugador identificable. |
| Ruptura | `bDestroyed` junto a un incremento de animación y referencia de búsqueda replicada. Se muestra como ruptura porque el cambio puede liberar botín sin una apertura manual. La destrucción aislada queda fuera. |
| Disparo | `SingleUseLootCannonFired` y referencias de `SpawnedPickupLoot`. El array de 43.00 se validó con `BGA_LootCannon_StandardChest_Pirate` y `BGA_LootCannonDuck_Child`. También aparece un actor de globos de confeti con otro esquema. Su nombre no basta para contar una activación. |
| Jugador | `SearchingPawn` en la misma actualización y enlace del pawn con `PlayerState`. Una referencia inmediatamente anterior sin reemplazo inequívoco se marca como inferida. El disparo de los cañones del corpus carece de un autor identificable. |
| Escuadrón | `RecorderPlayerState` identifica al grabador. Los demás estados coinciden por `TeamIndex` y, cuando está presente en ambos estados, `SquadId`. La referencia `PlayerTeamPrivate` sirve como alternativa cuando falta el índice. `UniqueID` se resume localmente con SHA-256 para agrupar a una misma cuenta entre partidas. Se contrastó que los alias de `PlayerNamePrivate` cambian y las huellas de las mismas cuentas se mantienen. |
| Nombres de Epic | Se descodifica `PlayerNameData` del bloque externo y se enlaza por GUID al estado de jugador. Las exportaciones incluyen el historial por partida. La huella estable de cuenta agrupa partidas aunque el nombre visible cambie. |
| Artilugios | Se comprueba la clase de un actor dinámico cuando se abre su canal de replicación. El diccionario por sí solo puede enumerar referencias precargadas y queda fuera del recuento. Se observaron 22 actores `B_RelicExtractor_C` (ID `WID_RelicExtractor`), 6 `B_LuckyLocator_C` (ID `WID_LuckyLocator`) y 4 `B_SmugglerExtractionKey_C` (ID `WID_SmugglerExtractionKey_Gizmo`). La primera observación indica presencia del actor y deja sin determinar el uso y la obtención. El consumible de inventario `WID_RelicExtractor_Consumable` se clasifica aparte en Botín. [Artilugios de extracción, Epic Games](https://www.epicgames.com/help/c-34254770/c-33726977/a24394995?lang=es-MX). |
| Botín vinculado | `SpawnedPickupLoot` contiene los GUID de los actores que emite el cañón. En contenedores, se exige que `Owner` apunte al dispensador observado y que `bTossedFromContainer` esté activo. Se comprueba además la coherencia temporal. El indicador de contenedor sin un actor de origen resoluble queda como contenedor indeterminado. |
| Recogida | `bPickedUp` se presenta como estado separado. La cercanía temporal o espacial, por sí sola, nunca establece el origen. |
| Nombre, rareza, coordenadas | `ItemDefinition` se resuelve en el diccionario de GUID cuando el archivo lo permite. El nombre de catálogo y la rareza proceden de los datos disponibles. La aplicación incluye etiquetas de objetos de extracción verificados por ID y admite catálogos locales para los demás. Las coordenadas en cm aparecen cuando se replican para el actor. |
| Pirate Shop Access | En la rama 43.00 el ID exacto del premio es `DelilahPrize:PirateAccount`. El analizador lee `PrizeTemplateId` de los actores de cofre animado y exige `bSuccess` antes de mostrar un premio. Un actor de cofre animado sin la plantilla exacta queda como otro premio o como desconocido. |

## Cómo se distingue el token pirata

El recurso del cliente `DelilahTreasureHuntGameplay` del build público 43.00 CL 59596594 asocia el acceso a la tienda con `DelilahPrize:PirateAccount`. La detección compara ese identificador completo y la rama de la grabación. Lee la propiedad de red `PrizeTemplateId` en `BGA_DelilahTreasureHuntAnimatedChest` y las variantes de la misma familia. `SourceContainer` y `OpeningPawn` aportan el contenedor y el jugador si el replay permite resolver las referencias. `bFromDestruction` marca los casos observados por ruptura. [Recurso del juego exportado como JSON](https://prod.fn-api.cc/v1/assets/json?path=FortniteGame%2FPlugins%2FGameFeatures%2FDelilahTreasureHuntGameplay%2FContent%2FDelilahTreasureHuntGameplay), [anuncio de la temporada](https://www.fortnite.com/news/fortnite-treasure-hunters-the-greatest-adventure-of-all-time?lang=en-US).

En el lote real aparecieron dos premios, `DelilahPrize:dpid_item15` (mochila Lil’ Uzi Crew) y `DelilahPrize:dpid_item16` (pista London), ambos en la misma partida. Los dos se leen del flujo del replay. La coincidencia positiva de la plantilla del token se comprobó con un caso sintético. Sigue pendiente validarla en una repetición real con el token. Un resultado vacío solo describe los datos capturados. Para comprobar si la cuenta recibió el acceso se consulta Fortnite.

## Formato y compatibilidad

El archivo Unreal empieza con la firma `0x1CA2E27F`. Los bloques de datos contienen fotogramas, paquetes de red y diccionarios de propiedades replicadas. En 43.00, los datos están cifrados con AES-ECB y comprimidos con el códec Mermaid de Oodle. Se usa la clave que contiene el propio archivo terminado. El lector omite los checkpoints y recorre la grabación secuencialmente. Consulta la descripción del sistema de replay y el lector de referencia. [Epic Games](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-the-replay-system-in-unreal-engine), [FortniteReplayDecompressor](https://github.com/Shiqan/FortniteReplayDecompressor/tree/76f74c1f640069afdba71b6468e2f819327893c2).

El parser identifica propiedades por nombre de exportación y conserva la versión de la grabación. La ruta Rust se habilita para la versión 43.00 con contenedor 7, cabecera de red 19 y protocolo de motor 45. Para otras combinaciones la web intenta usar el lector de compatibilidad anterior. Un parche que cambie la serialización de `SpawnedPickupLoot` requiere validar sus referencias de nuevo. Los datos de otras versiones se identifican con su versión real y pueden quedar parciales o incompatibles. [Historial del lector Unreal.Core](https://github.com/Shiqan/FortniteReplayDecompressor/commits/master/src/Unreal.Core/ReplayReader.cs).

Cada worker procesa una repetición a la vez. Se crean hasta cuatro workers independientes para repartir las repeticiones del lote, con un límite más bajo en equipos con poca memoria. Se limita cada repetición a 128 MiB y cada bloque decodificado a 64 MiB. Los ZIP se leen por entradas, se comprueba el CRC y se limita la extracción al tamaño declarado. El tiempo límite del worker permite retomar el lote después de un bloqueo. Las huellas del archivo y el GUID de la grabación evitan sumar copias. No se escribe nada en las carpetas de origen.

## Implementación y licencias

- El motor Rust compila a WebAssembly. Usa `oozextract` 0.5.7 para Mermaid y RustCrypto para AES y SHA-256. El lanzador y el lector de compatibilidad permanecen en .NET. En una medición en Edge con las mismas ocho repeticiones, el lector anterior tardó 105 s y el motor Rust tardó 7,9 s con un worker y 3,8 s con cuatro. La medición incluye la importación del lote en la web y se realizó antes de añadir las vistas de suministros y artilugios. [oozextract](https://docs.rs/crate/oozextract/0.5.7), [RustCrypto](https://github.com/RustCrypto).

- Se reutiliza el código fuente de Unreal.Core y OozSharp de Shiqan en el commit indicado. La adaptación incluye controles de longitud y avance del decodificador. OozSharp conserva los avisos GPL-3.0-or-later de su origen. El ZIP de distribución incluye el código correspondiente y las licencias. [FortniteReplayDecompressor](https://github.com/Shiqan/FortniteReplayDecompressor/tree/76f74c1f640069afdba71b6468e2f819327893c2), [ooz](https://github.com/powzix/ooz).
- El modelo de búsqueda por `SearchingPawn` y las referencias de estado del grabador se contrastaron con Chest Counter. [Chest Counter](https://github.com/rossalv/fortnite-chest-counter/tree/47a50821de9eb35f1de601958517be0f2e441456).
- El motor compilado carga en un worker con un listener de mensajes separado de `onmessage` para evitar el bloqueo de inicialización documentado en el runtime. [Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-on-webworkers), [dotnet/runtime #114918](https://github.com/dotnet/runtime/issues/114918).

