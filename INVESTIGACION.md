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


## Investigación de recompensas y cobertura por clase

### Revisión del ZIP experimental

El ZIP se leyó como datos y se comparó con el árbol local. Los únicos cambios funcionales eran una feature de diagnóstico, su salida en el lector Rust y la invalidación de la caché de grupos ausentes. Al reencontrar una ruta con un fallo de caché se consultan únicamente los esquemas añadidos desde el último intento. También se invalida la resolución positiva si cambia la ruta de un GUID. La llegada de un GUID por primera vez ya era consultable y el defecto estaba en los **fallos almacenados para rutas conocidas**. La corrección permite recuperar actualizaciones posteriores. No se vuelven a interpretar bloques antiguos que ya se descartaron.

Se implementó un diagnóstico propio a partir de la idea del ZIP. Registra nombres de exportación, referencias, número de bloques y hasta cuatro muestras de tiempo, actor y tamaño por clase y modo. Omite los prefijos hexadecimales y el programa auxiliar del ZIP. El diagnóstico se habilita solo para compilaciones nativas con la feature `reward-probe`. El JSON incluye los resultados normales y debe mantenerse en local si contiene datos de jugadores.

```powershell
cargo run --manifest-path engine-rust/Cargo.toml --locked --release --features reward-probe --bin replay -- "Demos/UnsavedReplay-2026.11.06-20.43.22.replay" > .research/diagnostico-premios.jsonl
```

### Pruebas de replicación de habilidades

| Grabación indicada | Bloques de red descifrados, descomprimidos e interpretados |
| --- | ---: |
| 06/11/2026 · 20:43 | 57 |
| 06/11/2026 · 22:28 | 58 |
| 07/11/2026 · 01:57 | 73 |
| 07/11/2026 · 15:18 | 54 |
| 08/11/2026 · 15:19 | 52 |
| **Total** | **294** |

Las cinco son del build 59594394 y contienen la exportación de `ActivatableAbilities` en `FortAbilitySystemComponentAthena_ClassNetCache`. El diagnóstico también vio los nombres exportados `GrantedAbilitySpecs` y `GrantedAbilityHandles`, bloques de propiedades y bloques personalizados de `AbilitySystemComponent` y `FortAbilitySystemComponent`, y siete bloques personalizados asociados a `GA_TreasureHandler_Generic_C`. El lector de producción excluye los grupos `Kind::Other` y los bloques personalizados. El diagnóstico reconoce sus límites externos y trata de encuadrar el campo personalizado con la caché exacta de su clase. No obtuvo un campo `ActivatableAbilities` validado así ni decodificó su delta en un evento de concesión. La exportación de un nombre de campo no prueba que el replay contenga una actualización utilizable de ese campo. Los eventos auxiliares de las 100 grabaciones tampoco incluyen un evento de premio identificado.

Unreal documenta `ActivatableAbilities` como un contenedor de `FGameplayAbilitySpec` serializado con FastArray. Una capacidad disponible, su activación y la acreditación de un premio son evidencias distintas. [Gameplay Abilities](https://dev.epicgames.com/documentation/unreal-engine/using-gameplay-abilities-in-unreal-engine), [FGameplayAbilitySpecContainer](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/GameplayAbilities/FGameplayAbilitySpecContainer?lang=en-US).

### Recompensas y certeza

El panel **Artilugios** separa actores observados, eventos de premio y concesiones al escuadrón. Las plantillas exactas del recurso 43.00 identifican los tipos siguientes cuando el actor de premio replica `bSuccess` y el lector interpreta `PrizeTemplateId`.

| Tipo | Plantilla del premio | Actores observados en el lote |
| --- | --- | ---: |
| Extractor portátil | `DelilahPrize:dpid_item10` | 22 |
| Localizador de la suerte | `DelilahPrize:dpid_item13` | 6 |
| Llave de extracción | `DelilahPrize:dpid_item9` | 4 |

El número de actores indica presencia. Las actualizaciones del mismo actor de premio se consolidan por NetGUID dentro de su repetición. Las notificaciones de jugadores quedan fuera del recuento. Para clasificar una concesión como confirmada haría falta una señal que vincule el premio con la concesión compartida. El nivel probable se reserva para indicios verificables y queda sin usar en este lote. Las coincidencias de catálogos de objetos del suelo siguen separadas.

Las cinco grabaciones indicadas carecen de premios de cofre interpretados. En el lote de 100 siguen apareciendo la mochila Lil’ Uzi Crew (`dpid_item15`) y la pista London (`dpid_item16`). No apareció `DelilahPrize:PirateAccount`. Si se observa esa plantilla exacta con éxito, la evidencia corresponde al evento del cofre capturado. La concesión al escuadrón o la acreditación en Epic quedan sin determinar. [Datos del recurso DelilahTreasureHuntGameplay](https://prod.fn-api.cc/v1/assets/json?path=FortniteGame%2FPlugins%2FGameFeatures%2FDelilahTreasureHuntGameplay%2FContent%2FDelilahTreasureHuntGameplay).

### Contenedores e iconos

El panel **Contenedores por clase** muestra unidades detectadas a partir de actores observados con una clase de contenedor conocida o con propiedades de búsqueda reconocibles. Reutiliza la deduplicación de GUID y de identidad de contenedores del lector. Los contenedores que vuelven a replicarse con otro GUID pueden agruparse por nombre o, si falta, por clase y posición. Ese último criterio es aproximado. Los **abiertos** incluyen el estado ya abierto y las aperturas registradas. La columna **destruidos** cuenta actores con `bDestroyed` y muestra en cuántos se observó el campo. Ese estado puede incluir retiradas por el juego y no atribuye la destrucción a un jugador. Ambas columnas se solapan. Si falta cobertura, la interfaz marca **No determinado**. El botín cuenta únicamente objetos vinculados a una activación mediante la evidencia del lector.

Se observaron por separado cofres normales, de aparición fija, raros, de nivel 5, de reliquias, enterrados y de espíritu, cajas de munición, cajas de alimentos, barriles de cañas y entregas de suministros. Se localizaron blueprints de nevera, caja de herramientas y caja registradora en los recursos de 43.00, pero esas clases no se observaron como contenedores en el lote. Los blueprints de munición `Tiered_Ammo_Athena` y `Tiered_Short_Ammo_3_Parent` usan mallas distintas. Solo el primero aparece en estos recuentos y queda pendiente establecer una etiqueta fiable de «grande». Tampoco se validó una caja fuerte en el lote.

Los recursos identificados incluyen mallas de cajas de munición y el recurso de vista previa de Pirate Shop Access. El índice de recursos no otorga una licencia de redistribución de esas imágenes. La interfaz usa iconos neutros de Lucide, con su licencia incluida en el proyecto. [Política de contenido de fans de Epic](https://legal.epicgames.com/epicgames/fan-art-policy), [condiciones de FN Api](https://fn-api.cc/tos#ip).

### Comparación con 1.1.1

En el lote de 100 repeticiones se recuperaron 30 activaciones adicionales en el resumen del lector (11.168 frente a 11.138) y 31 vínculos de botín adicionales (23.085 frente a 23.054). Las dos plantillas de premio identificadas y las 32 observaciones de actores de artilugio se mantuvieron.

Una medición local alternó ambas compilaciones WASM, con las mismas 12 repeticiones precargadas, una ejecución de calentamiento y dos pasadas por versión. La media fue de 8,23 s en 1.1.1 y 8,52 s en la compilación local, cerca de un 3,5 % más en esa muestra. La prueba mide el motor sin la interfaz.

## FastArray y concesiones de recompensas en Fortnite 43.00

### Formato comprobado

El diagnóstico nativo `reward-probe` interpreta `ActivatableAbilities` para Fortnite 43.00 CL 59594394, con versión de red del motor 45 y de grabación 19. Lee los campos personalizados tanto en bloques dedicados como después del terminador de las propiedades normales. Usa `FortAbilitySystemComponentAthena_ClassNetCache` para encuadrar el campo y las exportaciones de `FortAbilitySystemComponentAthena` para interpretar los índices internos. El nombre corto `AbilitySystemComponent` puede corresponder a varias clases. Se exige una entrada que contenga una referencia de habilidad y su handle para aceptar los deltas de cada par actor/componente. Un bloque vacío o que solo contiene bajas no basta para asociar un componente a ese esquema.

En las grabaciones se observó un bit inicial de serialización delta de estructuras seguido por cuatro enteros de 32 bits. En orden, son la clave de replicación del array, la clave base y los recuentos de bajas y escrituras. A continuación van los IDs de replicación de las bajas explícitas y, por cada escritura, su ID y una lista de propiedades indexadas de longitud delimitada. Los índices de propiedad, los NetGUID, el handle de habilidad y el ID de replicación cumplen funciones distintas. El lector recupera `ability`, `SourceObject`, `HandleValue`, `Level` e `InputID`. Comprueba el encuadre de otros campos conocidos, entre ellos `DynamicAbilityTags` y `ReplicatedInstances`. Las referencias se contrastan con las exportaciones NetGUID, incluidas las que llegan después del delta. [FGameplayAbilitySpecContainer](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/GameplayAbilities/FGameplayAbilitySpecContainer), [FastArray en Unreal](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/NetCore/TFastArrayTypeHelper), [cabecera FastArray](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/NetCore/FFastArraySerializer/FFastArraySerializerHeader).

El estado observado se reconstruye por actor, componente e ID de replicación. La primera ventana de observación y los cambios de base que requieren reiniciar esa ventana se separan de las entradas nuevas posteriores. Una actualización parcial conserva los campos anteriores que no llegaron en el delta. Se aplican las bajas explícitas y se descartan claves repetidas o atrasadas. La reconstrucción cubre los campos y bajas observados en el flujo de red. Quedan fuera las eliminaciones implícitas, los checkpoints y los intervalos que el flujo no permite reconstruir. [DemoNetDriver y checkpoints](https://dev.epicgames.com/documentation/en-us/unreal-engine/demonetdriver-and-streamers-in-unreal-engine).

### Qué se puede inferir de cada señal

| Señal | Resultado en el lote |
| --- | --- |
| Nombre exportado | Confirma que el esquema o el diccionario conoce ese nombre. `GrantedAbilitySpecs` y `GrantedAbilityHandles` se vieron como exportaciones. Sus valores fuera de `ActivatableAbilities` siguen sin interpretar. |
| Habilidad disponible | Una entrada identificada en la lista indica que la grabación la muestra disponible en ese componente. |
| Entrada nueva en una ventana observada | Un ID aparece después de la base. Puede corresponder a una habilidad añadida en partida o que empezó a replicarse en ese momento. |
| Activación de una habilidad | Hace falta una llamada o un cambio de estado de activación que pueda interpretarse. En los esquemas de habilidades del lote no se encontró una exportación utilizable de `ActiveCount`, `ActivationInfo` o de una RPC explícita de activación. Los bloques personalizados de `GA_TreasureHandler_Generic_C` que se correlacionaron con premios eran de cero bits. |
| Concesión compartida | Para confirmarla hace falta un identificador de premio y evidencia de su concesión al escuadrón. Ningún delta observado proporcionó esa combinación. |

La documentación de Unreal distingue dar acceso a una habilidad de activarla. También identifica `ActivationInfo` y `ActiveCount` como campos que el `FGameplayAbilitySpec` documentado no replica. Esta documentación sirve para interpretar los estados. Los límites y el orden del formato de arriba se verificaron con los archivos del build indicado. [FGameplayAbilitySpec](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/GameplayAbilities/FGameplayAbilitySpec), [concesión y activación de habilidades](https://dev.epicgames.com/documentation/unreal-engine/using-gameplay-abilities-in-unreal-engine).

### Resultados en grabaciones reales

| Grabación indicada | Deltas aplicados | Entradas de base | Primeras apariciones posteriores | Cambios en campos leídos | Bajas explícitas |
| --- | ---: | ---: | ---: | ---: | ---: |
| 06/11 · 20:43:22 | 2.416 | 60 | 442 | 67 | 421 |
| 06/11 · 22:28:32 | 3.049 | 60 | 670 | 49 | 720 |
| 07/11 · 01:57:25 | 1.481 | 60 | 258 | 48 | 309 |
| 07/11 · 15:18:59 | 2.049 | 60 | 489 | 69 | 542 |
| 08/11 · 15:19:07 | 2.566 | 60 | 723 | 67 | 774 |
| **Lote de 100** | **136.335** | **6.063** | **33.179** | **3.752** | **35.374** |

En el lote, 92.234 deltas se leyeron en bloques dedicados y 44.101 después de propiedades. Otros 254 tenían un encuadre compatible, pero se descartaron por faltar una entrada que identificara el esquema en ese componente. Los 100 archivos aportaron algún delta. De ellos, 99 aportaron resultados utilizables para el análisis de contenedores. Los recuentos de habilidades incluyen todos los componentes observados en la grabación.

- **Disponibilidad de los tres artilugios.** `SourceObject` referencia juntos a `WID_RelicExtractor`, `WID_LuckyLocator` y `WID_SmugglerExtractionKey_Gizmo` en 99 grabaciones. Sus primeras apariciones se sitúan entre 28,201 y 103,922 s, incluida cada una de las cinco grabaciones indicadas. Las referencias de tutorial y uso acompañan a esas entradas. Los tres IDs distinguen las definiciones y se repiten incluso cuando faltan premios de cofre identificados. En esas mismas 99 grabaciones se observó `GA_Prizes_EventListener_C` en la primera base, antes de 0,840 s.
- **Localizador de la suerte.** En `UnsavedReplay-2026.11.07-02.38.51.replay`, a 502,882 s, el actor 256 y componente 658 incorporan el ID de replicación 410 de `GA_LuckyLocator_Active_Child_C`. Su `SourceObject` es el NetGUID 27226, el mismo del actor `B_LuckyLocator_C` observado en ese fotograma. El vínculo al localizador concreto está confirmado. Es evidencia probable de despliegue y deja la adquisición al escuadrón sin determinar.
- **Extractor portátil y llave.** En `UnsavedReplay-2026.11.08-17.46.49.replay`, a 294,095 s, el actor 1270 y componente 2906 incorporan el ID de replicación 211 de `GA_RelicExtractor_Active_C`. Su `SourceObject` coincide con el actor `B_RelicExtractor_C` 21544, observado en ese fotograma. También es evidencia probable de despliegue. `GA_RelicExtractor_Active_Reload_C` aparece en otras tres grabaciones, sin un actor de artilugio que coincida con el NetGUID de origen. Para la llave se observó la habilidad `GA_SmugglerExtractionKey_OnUse_C` disponible y actores de la llave. La comprobación no encontró una asociación equivalente entre un alta de habilidad y un actor de la llave.
- **Manejador de premios.** En `UnsavedReplay-2026.11.08-15.36.05.replay`, el actor 482 y componente 1108 añaden `GA_TreasureHandler_Generic_C` a 150,935 s. Aparece un bloque vacío de esa clase en el mismo fotograma. La ruptura de cofre más cercana está a 150,930 s. A 150,997 s, el actor de premio 18592 replica éxito con `DelilahPrize:dpid_item16` (London), `SourceContainer` 5961 y `bFromDestruction` verdadero. La diferencia entre el alta de la habilidad y el evento de premio es de unos 62 ms. En la misma grabación aparece `DelilahPrize:dpid_item15` a 365,257 s, con `SourceContainer` 10697. A 366,757 s hay una segunda alta del manejador y otro bloque vacío. Ambas altas tienen `SourceObject` nulo. En total se observaron 53 altas del manejador en 38 grabaciones frente a dos eventos de premio identificados en una grabación. Los eventos de premio confirman los dos cosméticos a nivel de cofre.
- **Token pirata.** La búsqueda de `DelilahPrize:PirateAccount` sigue sin un positivo real en estos archivos. La comprobación sintética anterior sigue siendo la única prueba positiva de la rama exacta del detector. Un evento de éxito con esa plantilla demostraría que se registró el resultado del cofre. Para verificar la acreditación permanente haría falta evidencia de la cuenta.

La concesión al escuadrón de los tres artilugios queda **No determinada**. Los deltas son observaciones de componentes y no se suman como premios ni como notificaciones de cada compañero. Los eventos de cofre que sí tienen evidencia directa mantienen la consolidación por actor de premio dentro de la grabación.

### Código y reproducción

`engine-rust/src/fast_array.rs` contiene el lector, el estado observado, el diagnóstico de referencias y las pruebas unitarias. `network.rs` extrae los campos personalizados y `analysis.rs` expone las muestras bajo `rewardProbe.abilities`. La compilación limita este código a Rust nativo con `reward-probe`. El diagnóstico limita tamaños, listas y muestras. Un delta desconocido o malformado se descarta localmente y el lector normal conserva los demás datos. Los JSONL incluyen el resultado de análisis de cada repetición y se guardan en local.

```powershell
New-Item -ItemType Directory -Force .research | Out-Null
$replays = (Get-ChildItem Demos -Filter '*.replay' | Sort-Object Name).FullName
cargo run --manifest-path engine-rust/Cargo.toml --locked --release --features reward-probe --bin replay -- @replays > .research/fastarray-all.jsonl
```

### Validación y rendimiento

- Rust pasó las cuatro pruebas habituales y las siete con `reward-probe`. Las pruebas nuevas cubren el formato de bits, referencias NetGUID, truncamiento, contadores fuera de límite, IDs duplicados, cambios parciales, reinicio de base y repetición de una clave. En un lote nativo con una grabación real cortada a la mitad, el archivo truncado se marcó parcial y el original siguiente se procesó completo.
- Compilaron Rust nativo y WebAssembly con y sin `reward-probe`. También pasó `npm run build`, incluido TypeScript y el empaquetado web.
- El navegador procesó dos grabaciones válidas junto con una copia duplicada y un archivo corrupto. Verificó la exclusión de duplicados y la importación y exportación JSON y CSV. En el lote de 100, 99 archivos fueron utilizables para contenedores y se conservaron 11.168 activaciones de contenedores y 23.085 vínculos de botín.
- El WASM anterior a este cambio y el actual devolvieron JSON equivalente en las mismas 12 grabaciones. Después de calentar ambas versiones se alternaron dos pasadas por versión. Los tiempos fueron 8,76 y 9,07 s antes, y 8,37 y 8,77 s después. La muestra no mostró una penalización en el motor habitual. El diagnóstico de FastArray queda excluido de WebAssembly.

## Recuento de adquisiciones del escuadrón por partida

Se volvió a analizar el lote de 100 archivos de Fortnite 43.00 con el lector FastArray y un barrido de nombres de campos, clases y eventos auxiliares. Los cuatro totales quedan **No determinado** en cada grabación. En **Partidas**, el detalle muestra el estado de cada recompensa por separado junto a su plantilla. Si se observa una plantilla exacta en un premio de cofre, el detalle muestra esa evidencia sin asignarla a un total de adquisiciones.

| Recompensa | Plantilla | Total verificable del escuadrón |
| --- | --- | --- |
| Extractor portátil | `DelilahPrize:dpid_item10` | No determinado |
| Localizador de la suerte | `DelilahPrize:dpid_item13` | No determinado |
| Llave de extracción | `DelilahPrize:dpid_item9` | No determinado |
| Token pirata | `DelilahPrize:PirateAccount` | No determinado |

### Vías comprobadas

1. **Registro de premios de la partida.** El recurso del juego configura `B_PlayerController_TreasureHuntMatchDataComponent` como componente del cliente. El Blueprint declara `InitialPrizes` y `EarnedPrizes` como mapas de nombre a entero, y funciones `AddRewardEarned(RewardId, Amount)` y `GetAllPrizesEarnedThisMatch`. Los mapas carecen del flag `Net` y las dos funciones carecen de flags de red. La clase, los mapas y la estructura `BPS_PrizeEarnedData` tampoco se encontraron en las exportaciones de las grabaciones analizadas. El recurso también configura `B_GameState_TreasureHuntController` para el servidor. Se encontraron referencias a ese objeto, pero ningún esquema de campos para obtener sus totales. [Configuración del Game Feature](https://prod.fn-api.cc/v1/assets/json?path=FortniteGame%2FPlugins%2FGameFeatures%2FDelilahTreasureHuntGameplay%2FContent%2FDelilahTreasureHuntGameplay), [Blueprint del registro de premios](https://prod.fn-api.cc/v1/assets/json?path=FortniteGame%2FPlugins%2FGameFeatures%2FDelilahTreasureHuntGameplay%2FContent%2FGameplay%2FComponents%2FB_PlayerController_TreasureHuntMatchDataComponent).
2. **Contexto enviado al cliente.** El recurso de `GA_TreasureHandler_Generic_C` declara la RPC fiable de cliente `Client_ReplicateContext` con `PrizeId` y `Container`. Es una pista para identificar un premio y su fuente. En las 100 grabaciones no apareció su nombre en campos, rutas exportadas ni referencias NetGUID, y todas las muestras de bloques del manejador tenían cero bits de contenido. Las 53 altas de esa habilidad no proporcionaron un recibo de concesión. [Blueprint del manejador](https://prod.fn-api.cc/v1/assets/json?path=FortniteGame%2FPlugins%2FGameFeatures%2FDelilahTreasureHuntGameplay%2FContent%2FGameplay%2FAbilities%2FPrizeHandlers%2FGA_TreasureHandler_Generic).
3. **Premio de cofre.** Los únicos controles positivos fueron `dpid_item15` y `dpid_item16`. Ambos se vinculan a integrantes del escuadrón por el identificador de quien abrió el cofre y a contenedores distintos. Ese vínculo permite atribuir la apertura. El evento de éxito confirma el premio registrado por el cofre, pero carece de un recibo de entrega compartida y de una garantía de cobertura de todos los premios. Ninguna de las cuatro plantillas objetivo apareció como premio de cofre en el lote.
4. **Estado y etiquetas.** El índice dinámico de etiquetas exportó `Granted.Gizmo.SmugglerExtractionKey.Owned.Shared` en 99 archivos y `Granted.Gizmo.SmugglerExtractionKey.Cooldown.Shared` en cinco. Una entrada del diccionario indica que se conoce la etiqueta. Incluso un estado activo de propiedad o enfriamiento requeriría una relación validada con cada concesión para servir como recuento histórico. Lo mismo se aplica a altas de habilidades, actores y despliegues. [Contenedor de etiquetas de Unreal](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/GameplayAbilities/FMinimalReplicationTagCountMap).
5. **Eventos auxiliares.** El barrido del encabezado de eventos encontró seis grupos ya conocidos. `AthenaMatchStats` declara 64 bytes y `AthenaMatchTeamStats` declara 16. No apareció un grupo de premio ni una estructura validada que asocie estos eventos a las cuatro cantidades. Los tamaños describen el encuadre y no identifican el significado de su contenido. La relevancia de red y el filtrado del sistema de replay impiden usar la falta de un evento como prueba de cero. [Relevancia de actores en Unreal](https://dev.epicgames.com/documentation/unreal-engine/actor-relevancy-in-unreal-engine).

### Regla de recuento

Un total exacto requiere un registro acumulado final con cobertura verificada o eventos de concesión completos, con el escuadrón receptor, la plantilla y una identidad estable de la concesión. Con un identificador de concesión se cuenta una vez aunque haya avisos para varios compañeros. Una clave de cofre y plantilla solo serviría después de verificar que ese cofre puede conceder esa plantilla una única vez. El NetGUID del actor de premio permite consolidar sus propias actualizaciones, pero no se ha validado como identidad común de avisos de varios jugadores. Un cero exige la misma garantía de cobertura que un total positivo.

El barrido queda en el diagnóstico nativo `reward-probe` bajo `rewardProbe.acquisitionExports` y `rewardProbe.eventPayloadSizes`. Usa el comando anterior con otro nombre de salida si se desea conservar la comparación. Las pruebas de navegador comprueban que una plantilla exacta se muestra como evidencia separada, que una coincidencia de otra versión se excluye y que los cuatro estados se traducen al inglés.

## Investigación final de rutas de entrega y fuentes alternativas

Revisión del 11 de noviembre de 2026. El objetivo de esta fase es decidir si se pueden obtener cuatro cantidades exactas por partida. Los cuatro resultados siguen en **No determinado**. La revisión conserva la distinción entre un premio observado en un cofre, la disponibilidad de un artilugio, su despliegue y su concesión compartida.

### Alcance de los recursos y de la comprobación

Se revisaron por completo las conclusiones anteriores y los JSON de recursos ya guardados en el proyecto. Corresponden a la investigación del cliente público 43.00 CL 59596594. Las grabaciones son de CL 59594394. Esta diferencia de build impide tratar los recursos como una especificación binaria exacta de las grabaciones.

Se intentó consultar las estructuras de eventos, el listener de premios, el selector de cofre y las definiciones de los tres artilugios en el mismo servicio público de JSON usado anteriormente. Las diez solicitudes devolvieron HTTP 403. La comprobación de esas estructuras quedó limitada a los recursos y referencias ya guardados. Los JSON de funciones disponibles describen firmas y variables temporales, pero carecen del bytecode o del grafo ejecutable. Permiten identificar mecanismos candidatos y no demostrar el flujo de ejecución ni todas sus condiciones.

### Rutas identificadas y preguntas pendientes

| Ruta | Evidencia concreta | Límite para contar |
| --- | --- | --- |
| Selección de premio de cofre | El Game Feature contiene entradas de desarrollo que pasan las cuatro plantillas objetivo y las plantillas cosméticas al mismo selector denominado `DelilahTreasureHunt_ForceNextChestReward`. Se examinaron como metadatos. | Esto relaciona los artilugios con el sistema de premios de cofre. No establece que todos los tipos creen el mismo actor ni que todos repliquen su entrega. |
| Contexto de habilidad | Los temporales del manejador genérico incluyen un objeto `DelilahTreasureHuntPrizeContext`. Su RPC `Client_ReplicateContext` recibe `PrizeId` y `Container`. `Local_Execute` recibe un contexto. | La firma acredita una vía de comunicación al cliente. Las grabaciones no contienen un payload interpretado de esa RPC. Los temporales carecen del grafo que permita demostrar cómo se enlazan la entrega, el contexto y el actor. |
| Actor de cofre animado | `bSuccess`, `PrizeTemplateId`, `SourceContainer`, `OpeningPawn` y `bFromDestruction` identifican dos resultados cosméticos reales. | No se ha probado que el actor se cree y replique para cada premio ni que el éxito visual equivalga a una concesión compartida. |
| Registro local de partida | El componente cliente mantiene los mapas `InitialPrizes` y `EarnedPrizes`. Los temporales de su función principal hacen referencia a `BPS_Event_PrizeEarned`, a `BPS_PrizeEarnedData`, a un router global de eventos y a operaciones de mapas. | Es evidencia de una ruta local de eventos que puede alimentar el registro. Faltan sus instancias con valores. El nombre de una estructura en el recurso no constituye un bloque persistido en la replay. |
| Controlador del servidor | El recurso configura `B_GameState_TreasureHuntController` en el servidor. Su clase deriva de `DelilahTreasureHuntCloverController_Server`. | La existencia del controlador y sus referencias exportadas no proporcionan su lógica nativa ni un contador final registrado. |

Los artilugios y los cosméticos comparten identificadores del sistema Delilah y un punto de selección de premios documentado en el recurso. **Sigue sin verificarse que compartan toda la ruta de concesión y de creación de actores replicados.** No se ha demostrado que todos los premios generen un actor replicado. Tampoco se ha demostrado que los artilugios se entreguen exclusivamente mediante RPC. Ambas afirmaciones requerirían evidencia adicional.

En Unreal, una RPC marcada `Client` se dirige a la conexión propietaria. El indicador `Reliable` expresa garantías de transporte de esa llamada. Por sí solo no establece una garantía de conservación en un archivo de replay. Esta documentación explica la firma observada y no sustituye la comprobación concreta en Fortnite 43.00. [RPC en Unreal](https://dev.epicgames.com/documentation/unreal-engine/remote-procedure-calls-in-unreal-engine), [sistema de replay](https://dev.epicgames.com/documentation/unreal-engine/using-the-replay-system-in-unreal-engine).

Las fuentes de recursos de esta revisión son los JSON locales de `DelilahTreasureHuntGameplay`, `GA_TreasureHandler_Generic`, `B_PlayerController_TreasureHuntMatchDataComponent`, `B_GameState_TreasureHuntController` y `BGA_DelilahTreasureHuntAnimatedChest` que se citaron en las secciones anteriores. El inventario del recurso también enumera `GA_Prizes_EventListener`, `BPS_Event_PrizeEarned`, `BPS_Event_KeyEarned` y `BPS_Event_RewardWonWidgetReady`. La nueva consulta de sus contenidos quedó afectada por el HTTP 403.

### Contraste de los casos con más evidencia

Se auditaron los resultados nativos de las 100 grabaciones, con 100 GUID diferentes. La auditoría recuperó los mismos 136.335 deltas aplicados, 32 actores de artilugio en 23 grabaciones y 53 altas del manejador genérico en 38 grabaciones. En este corpus se conservó una muestra por cada uno de los 53 bloques del manejador y todas tenían cero bits. El esquema del actor de cofre animado apareció en una grabación.

| Grabación | Señales relevantes | Resultado del contraste |
| --- | --- | --- |
| `UnsavedReplay-2026.11.07-02.38.51.replay` | Actor de localizador vinculado por `SourceObject`, una alta del manejador genérico y ningún premio de cofre identificado | La asociación de despliegue carece de un recibo con plantilla de adquisición. La alta genérica no identifica un premio. |
| `UnsavedReplay-2026.11.08-15.36.05.replay` | Tres altas del manejador y los dos premios cosméticos `dpid_item15` y `dpid_item16` | Ambos premios de cofre se vinculan a integrantes del roster reconstruido. Tres altas y dos eventos identificados no permiten asignar un tipo al evento restante ni demostrar cobertura. |
| `UnsavedReplay-2026.11.08-17.46.49.replay` | Actor de extractor vinculado por `SourceObject`, sin alta del manejador y sin premio de cofre identificado | Un despliegue puede observarse sin un recibo de premio en esa grabación. Su existencia no indica si se consiguió durante esa partida. |

El diagnóstico de presencia abarca los actores recibidos por la grabación, incluidos los de otros equipos. La asociación entre una habilidad y un actor de artilugio identifica ese vínculo. No demuestra el equipo que recibió un premio. Para los dos cosméticos, el enlace de `OpeningPawn` con el roster acredita la relación de la apertura con el escuadrón, con los límites de entrega ya documentados.

Los eventos recuperados carecen de una garantía de completitud. El estado «completo» del analizador describe la lectura de su flujo compatible. Los checkpoints, los datos que no se replican y las rutas de comunicación que no quedan grabadas siguen fuera de esa garantía. Por tanto, los dos cosméticos no permiten certificar el historial completo de otros premios. La ausencia de una plantilla objetivo tampoco prueba un total cero.

### Fuentes alternativas verificadas

| Fuente | Qué se verificó | Relación posible con una replay y resultado |
| --- | --- | --- |
| Logs oficiales del cliente | Epic documenta `FortniteGame`, `FortniteLauncher` y copias de respaldo en `%localappdata%/FortniteGame/Saved/Logs` para diagnosticar el comportamiento de la aplicación. | Existe una fuente real de diagnóstico. La documentación no especifica entradas `RewardId`/`Amount`, un identificador de concesión ni cobertura completa. En el material de esta revisión falta una muestra real y depurada de un log del cliente para contrastar una partida. Su capacidad para recuperar premios queda sin determinar. [Instrucciones oficiales de logs](https://www.epicgames.com/help/en-US/c-202300000001636/c-202300000001719/how-do-i-gather-logs-for-fortnite-a202300000017949?lang=en-US). |
| Fortnite Data API | La documentación pública describe métricas agregadas por isla, intervalos de diez minutos, una hora y un día, y acceso sin autenticación. También especifica que no comparte información personal de jugadores. | Sus datos documentados no incluyen un historial de recompensas por escuadrón ni un identificador de partida individual para enlazar estas cuatro cantidades. No resuelve el recuento. [Documentación de Data API](https://dev.epicgames.com/documentation/fortnite/using-fortnite-data-api-in-fortnite?lang=en-US), [Swagger público](https://api.fortnite.com/ecosystem/v1/docs/). |
| Carrera dentro de Fortnite | Epic documenta una pestaña con historial, estadísticas y progresión. | La documentación consultada no especifica estas cuatro cantidades por partida ni una exportación del registro de premios. Es una interfaz real, pero su capacidad para verificar este recuento sigue sin demostrar. [Estadísticas de Fortnite](https://www.epicgames.com/help/c-34254770/c-44323472/a16599089?lang=en-US). |
| Descarga de información de cuenta | Epic ofrece una descarga de datos de cuenta en PDF mediante su interfaz de cuenta. | La página no describe un esquema de concesiones con las cuatro plantillas, cantidades y partida. Se comprobó únicamente la documentación pública. El contenido de una cuenta privada no formó parte de esta revisión. [Descarga oficial de datos](https://www.epicgames.com/help/c-45487929/a19124322?lang=en-US). |
| Tablas y catálogos de recursos | Los recursos disponibles permiten reconocer definiciones, tipos y mecanismos candidatos. | Una tabla de premios posibles no aporta el resultado de una partida. Los catálogos y las existencias persistentes tampoco permiten reconstruir cuántas veces se concedió algo durante una partida concreta. |

La existencia de logs está documentada. Su contenido útil para este objetivo queda sin validar. En particular, una marca de hora o un cambio de inventario aislado no resolverían el enlace con la partida, el origen de la recompensa ni la cobertura. Esta revisión no añade importación de logs ni una fuente en línea al análisis habitual.

### Qué evidencia permitiría resolverlo

Sería necesario obtener al menos una de estas fuentes con cobertura comprobable.

- Un registro final de `EarnedPrizes` que incluya los identificadores y cantidades de las cuatro recompensas, vinculado de forma inequívoca a una partida y a su escuadrón. Habría que verificar si `Amount` representa unidades o número de concesiones.
- Un flujo completo de recibos de concesión con plantilla, cantidad, partida, escuadrón y un identificador común para los avisos compartidos. Ese identificador permitiría contar una entrega una sola vez.
- Una especificación o evidencia ejecutable del build correspondiente que demuestre que todas las entregas relevantes crean un registro recuperable por el lector, junto con casos reales positivos de cada una de las cuatro recompensas.

Una partida con un premio conocido y un registro independiente permitiría probar un candidato. Para declarar un total exacto, incluido cero, también habría que comprobar que todas las entregas de esa partida están representadas. Una coincidencia visual o temporal aislada seguiría siendo insuficiente.

### Validación de esta fase y decisión

La auditoría automática del JSONL comprobó el número de grabaciones, la unicidad de los GUID, los deltas, los actores, los bloques y la pertenencia al roster de los dos controles cosméticos. La entrada auditada fue `.research/squad-reward-dedup-refs.jsonl`, con SHA-256 `5d905222185fcbb4dda1a352f165658fa3ca23334b83cc5a188026ab8bcf7e27`. El resumen se guardó en `.research/final-rewards-audit.json`. Estos archivos contienen diagnósticos locales y no son nuevos datos entregados por el juego.

Se ejecutaron las siete pruebas Rust con `--locked --features reward-probe` y pasaron. Esta fase modifica el informe. Las comprobaciones de WebAssembly, TypeScript y navegador de la sección anterior corresponden a la última implementación del producto.

Con las fuentes actualmente verificadas, esta funcionalidad debe considerarse **limitada por los datos disponibles**. Ampliar el parser sobre el mismo lote no tiene una señal de concesión validada que justifique un nuevo contador. La investigación merece reabrirse cuando exista uno de los registros independientes descritos o una grabación positiva que permita validar una ruta nueva. Las cuatro cantidades permanecen **No determinado**.

## Regla de premios compartidos aclarada por el usuario

El usuario ha precisado que una recompensa que recibe cualquier integrante se concede al escuadrón entero, y que cada apertura puede producir como máximo un premio. Durante una partida pueden producirse varias adquisiciones, incluidas varias del mismo tipo en aperturas diferentes. Esta regla permite contar una adquisición compartida a partir de un premio identificado para un integrante. La exigencia anterior de un recibo adicional que acreditase la entrega a todos los compañeros queda sustituida por esta regla.

El recuento de adquisiciones observadas utiliza los premios de éxito ya recuperados por el lector. Exige la plantilla exacta de 43.00, una referencia de contenedor de origen y al menos un destinatario enlazado al roster de esa grabación. El jugador sirve para comprobar el equipo. Su identidad no interviene en el número de adquisiciones.

- Varios registros del mismo origen se agrupan y cuentan una vez, aunque aparezcan integrantes distintos.
- El mismo premio en dos orígenes distintos cuenta dos adquisiciones.
- El origen se agrupa dentro de cada replay. Dos partidas diferentes conservan sus propios recuentos.
- Si se registran plantillas contradictorias para el mismo origen, ese grupo queda fuera del recuento.
- Un registro con equipo o referencia de origen sin resolver conserva su evidencia y no aporta un incremento confirmado.

La implementación agrupa por `SourceContainer` recuperado como `sourceActor`. Esta referencia identifica el contenedor de origen y permite consolidar las observaciones de su apertura. El lector no distingue reaperturas del mismo actor de contenedor. Los números se presentan como **adquisiciones observadas**, con los orígenes consultables, y no garantizan cobertura del total de la partida. Sin una adquisición identificada se muestra **No determinado**.

`squadRewardOpenings` en `src/treasure.ts` aplica la regla a los resultados actuales y a informes importados. El detalle de Partidas y la columna de concesiones del resumen de artilugios utilizan el mismo cálculo. Las pruebas de navegador comprobaron cuatro avisos de una apertura como una adquisición, ocho avisos de dos aperturas como dos, un premio para un compañero como una adquisición de equipo y la exclusión de otros equipos, orígenes desconocidos, datos contradictorios y versiones distintas. Los casos positivos son sintéticos. El recorrido CSV conserva los recuentos.

En las 100 grabaciones reales se mantienen los dos cosméticos identificados y siguen faltando las cuatro plantillas objetivo como premio de éxito. La regla compartida resuelve cómo contar un positivo cuando aparece. La identificación de un positivo real de cada recompensa sigue pendiente. TypeScript, el empaquetado web y las pruebas de navegador pasaron.

## Nombres del juego, imágenes y correcciones de contenedores

El catálogo incluye nueve tipos de artilugio y dos variantes consumibles. Los nombres proceden de los campos `ItemName` del build público 43.00 CL 59596594. El inglés usa el texto de origen y el español se obtiene resolviendo la clave FText en `Fortnite_locchunk30/es` y `Fortnite_locchunk50/es`. Por ejemplo, `WID_SmugglerExtractionKey_Gizmo` se muestra como **Acelerador de extracción / Extraction Accelerator**. Los IDs internos se mantienen visibles para facilitar la comprobación.

Las once imágenes de objeto se cargan desde el paquete local. La fila vacía de artilugios sin identificar se retiró. El lector reconoce las clases de actor asociadas a las definiciones verificadas. La observación de una clase indica presencia. El ID de catálogo identifica el tipo de referencia y puede corresponder a varias variantes que comparten esa clase. Las imágenes, claves de texto, fuentes y huellas están registradas en `public/licenses/fortnite-artwork.txt`. [Documentación de la fuente de recursos](https://fn-api.cc/docs).

| Clase | Español | Inglés |
| --- | --- | --- |
| `B_SpritePosters_Booty_Chest` | Póster de espíritu | Sprite Poster |
| `B_SpritePosters_Booty_Chest_Variant1` | Póster de espíritu · variante 1 | Sprite Poster · variant 1 |
| `B_Athena_BuriedChest_RelicFinder` | Cofre enterrado de espíritu | Buried Sprite Chest |
| `Tiered_Chest_5_Child` | Cofre raro | Rare Chest |
| `AlwaysSpawn_RareChest` | Cofre raro · aparición fija | Rare chest · fixed spawn |

Los pósteres tienen su propio filtro de categoría. Recogerlos sigue contando como apertura según la regla indicada por el usuario y su actor puede aportar el origen de un premio de artilugio cuando la grabación contiene la evidencia de ese premio.

En la validación del lote de 100 repeticiones, el lector reconoció 65 actores de artilugios. A los 32 anteriores se sumaron 30 de Fuegos artificiales dorados y 3 de Localizador de espíritus. El navegador validó las imágenes locales, ambos idiomas y las correcciones de las clases de contenedor. La prueba sintética conservó cinco aperturas, incluidas dos recogidas de póster, y tres adquisiciones con sus orígenes identificados.
