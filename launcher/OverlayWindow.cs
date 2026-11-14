using System.Globalization;
using System.Runtime.InteropServices;

internal sealed class OverlayWindow : IDisposable
{
    internal sealed record RoleCounts(long? Recorder, long? Mates, long? Team, long Unassigned);
    internal sealed record RoleTotal(long? Total, int Games);
    internal sealed record Reward(string Spanish, string English, int? Count);
    internal sealed record Ranked(string? Name, long Opened);
    internal sealed record Period(int Matches, RoleTotal Recorder, RoleTotal Mates, RoleTotal Team, Reward[] Rewards, Ranked[] Top,
        Reward[]? RewardRecords, Reward[]? GizmoActors, long Unassigned);
    internal sealed record Counters(int Generation, int Found, int Unread, int Live, int Copies, int Pending, Period History, Period Session, RoleCounts? Last);
    private sealed record Scope(bool Chests, bool Average, bool Treasures, bool Top);
    private sealed record Sections(Scope History, Scope Session, bool Last, bool Status, bool Recorder, bool Mates, bool Team,
        int TopLimit, int SizePercent, int? CustomWidth, int? CustomHeight, TreasureMode TreasureView);
    private enum TreasureMode { All, Squad, Records, Actors }
    private readonly object gate = new();
    private ControlPanel? panel;
    private Guid? owner;
    private OverlayReplayFeed? feed;

    internal static int RunStandalone(string root)
    {
        using var overlay = new OverlayWindow();
        var thread = overlay.Start(Guid.NewGuid(), CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "es", root);
        thread.Join();
        return 0;
    }

    public void Dispose()
    {
        lock (gate) feed?.Dispose();
    }

    internal OverlayReplayFeed? Feed(Guid client)
    {
        lock (gate) return owner == client ? feed : null;
    }

    internal void Close(Guid client) => OnPanel(client, window => window.Close());
    internal void Update(Guid client, Counters counters) => OnPanel(client, window => window.Update(counters));

    private void OnPanel(Guid client, Action<ControlPanel> action)
    {
        lock (gate)
        {
            if (owner != client || panel is not { } window) return;
            try { window.BeginInvoke(() => action(window)); }
            catch (InvalidOperationException) { }
        }
    }

    internal bool Open(Guid client, bool spanish)
    {
        lock (gate)
        {
            if (owner is not null)
            {
                if (owner != client) return false;
                OnPanel(client, window =>
                {
                    if (window.WindowState == FormWindowState.Minimized) window.WindowState = FormWindowState.Normal;
                    window.Activate();
                });
                return true;
            }
            Start(client, spanish, null);
            return true;
        }
    }

    private Thread Start(Guid client, bool spanish, string? root)
    {
        owner = client;
        var session = feed = new OverlayReplayFeed();
        var thread = new Thread(() =>
        {
            try
            {
                using var window = new ControlPanel(spanish, session);
                lock (gate) panel = window;
                if (root is not null)
                    window.Shown += async (_, _) => await EmbeddedOverlayBrowser.Start(window, root, this, client, window.ShowError);
                Application.Run(window);
            }
            finally
            {
                lock (gate)
                {
                    session.Dispose();
                    feed = null;
                    panel = null;
                    owner = null;
                }
            }
        }) { IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return thread;
    }

    private sealed class ControlPanel : Form
    {
        private bool spanish;
        private readonly OverlayReplayFeed feed;
        private readonly Marker marker;
        private readonly TextBox folderPath = new() { ReadOnly = true };
        private readonly Label status = new();
        private readonly PictureBox placement = new();
        private readonly CheckBox[] historyOptions;
        private readonly CheckBox[] sessionOptions;
        private readonly CheckBox showLast;
        private readonly CheckBox showStatus;
        private readonly CheckBox showRecorder;
        private readonly CheckBox showMates;
        private readonly CheckBox showTeam;
        private readonly NumericUpDown topLimit;
        private readonly TrackBar sizePercent;
        private readonly CheckBox useCustomWidth;
        private readonly CheckBox useCustomHeight;
        private readonly NumericUpDown customWidth;
        private readonly NumericUpDown customHeight;
        private readonly ComboBox treasureView = new() { DropDownStyle = ComboBoxStyle.DropDownList };
        private readonly List<(Control Control, string Spanish, string English)> translations = [];
        private Counters? current;

        internal ControlPanel(bool spanish, OverlayReplayFeed feed)
        {
            this.spanish = spanish;
            this.feed = feed;
            Text = T("Control del overlay · Fortnite Chest Analyzer", "Overlay controls · Fortnite Chest Analyzer");
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.Sizable;
            MaximizeBox = false;
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(470, 574);
            MinimumSize = Size;
            Font = new Font("Segoe UI", 9.5f);
            marker = new Marker(spanish);

            var folder = new Button { AutoSize = true };
            Localize(folder, "Elegir carpeta", "Choose folder");
            folder.SetBounds(12, 12, 120, 29);
            folder.Click += (_, _) => ChooseFolder();
            var close = new Button { AutoSize = true };
            Localize(close, "Cerrar overlay", "Close overlay");
            close.SetBounds(333, 12, 125, 29);
            close.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            close.Click += (_, _) => Close();
            Controls.AddRange([folder, close]);
            var language = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, AccessibleName = "Idioma / Language" };
            language.SetBounds(178, 14, 112, 27);
            language.Items.AddRange(["Español", "English"]);
            language.SelectedIndex = spanish ? 0 : 1;
            language.SelectedIndexChanged += (_, _) => ChangeLanguage(language.SelectedIndex == 0);
            Controls.Add(language);
            folderPath.SetBounds(12, 48, 446, 24);
            folderPath.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            folderPath.AccessibleName = T("Carpeta vigilada", "Watched folder");
            folderPath.PlaceholderText = T("Ninguna carpeta seleccionada", "No folder selected");
            Controls.Add(folderPath);
            AddLabel(190, 80, 118, "Sesión", "Session");
            AddLabel(327, 80, 124, "Histórico", "History");
            var groups = new[] { ("Cofres", "Chests"), ("Medias", "Averages"), ("Tesoros", "Treasures"), ("Top de jugadores", "Player rankings") };
            historyOptions = new CheckBox[groups.Length];
            sessionOptions = new CheckBox[groups.Length];
            for (var index = 0; index < groups.Length; index++)
            {
                var (es, en) = groups[index];
                var row = 106 + index * 24;
                AddLabel(12, row, 165, es, en);
                sessionOptions[index] = AddScopeOption(190, row, $"{es} · Sesión", $"{en} · Session", index == 0);
                historyOptions[index] = AddScopeOption(327, row, $"{es} · Histórico", $"{en} · History", index == 0);
            }
            showLast = AddOption(12, 207, "Última partida", "Last match", true);
            showStatus = AddOption(190, 207, "Estado de lectura", "Reading status", false);
            var who = new Label();
            Localize(who, "Cofres abiertos o rotos por jugador o equipo", "Chests opened or broken by player or team");
            who.SetBounds(12, 237, 446, 22);
            Controls.Add(who);
            showRecorder = AddOption(12, 259, "Grabador", "Recorder", false);
            showMates = AddOption(117, 259, "Compañeros", "Teammates", false);
            showTeam = AddOption(251, 259, "Escuadrón completo", "Full squad", true);
            AddLabel(12, 293, 120, "Jugadores del top", "Ranking size");
            topLimit = AddNumber(136, 289, 1, 12, 4, 1, "Jugadores del top", "Ranking size");
            AddLabel(214, 293, 67, "Tesoros", "Treasures");
            treasureView.SetBounds(286, 289, 172, 27);
            LocalizeTreasureView();
            treasureView.SelectedIndexChanged += (_, _) => { if (treasureView.SelectedIndex >= 0) Render(); };
            Controls.Add(treasureView);
            AddLabel(12, 329, 157, "Tamaño del marcador", "Marker size");
            sizePercent = new TrackBar
            {
                Minimum = 60, Maximum = 150, Value = 100, SmallChange = 1, LargeChange = 10,
                TickStyle = TickStyle.None, AutoSize = false, Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right,
                AccessibleName = T("Tamaño del marcador", "Marker size"), Tag = ("Tamaño del marcador", "Marker size")
            };
            sizePercent.SetBounds(171, 322, 236, 29);
            var scaleValue = new Label { Text = "100 %", TextAlign = ContentAlignment.MiddleRight, Anchor = AnchorStyles.Top | AnchorStyles.Right };
            scaleValue.SetBounds(407, 325, 51, 22);
            sizePercent.ValueChanged += (_, _) =>
            {
                scaleValue.Text = $"{sizePercent.Value} %";
                Render();
            };
            Controls.AddRange([sizePercent, scaleValue]);
            useCustomWidth = AddOption(12, 358, "Ancho fijo (px)", "Fixed width (px)", false);
            customWidth = AddNumber(140, 355, 200, 1200, 350, 10, "Ancho al 100 %", "Width at 100%");
            customWidth.Enabled = false;
            useCustomWidth.CheckedChanged += (_, _) => customWidth.Enabled = useCustomWidth.Checked;
            useCustomHeight = AddOption(241, 358, "Alto fijo (px)", "Fixed height (px)", false);
            customHeight = AddNumber(393, 355, 100, 1400, 260, 10, "Alto al 100 %", "Height at 100%");
            customHeight.Enabled = false;
            useCustomHeight.CheckedChanged += (_, _) => customHeight.Enabled = useCustomHeight.Checked;
            status.SetBounds(12, 392, 446, 54);
            status.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            status.Text = T("Selecciona la carpeta de repeticiones.", "Select your replay folder.");
            Controls.Add(status);

            var placementLabel = new Label();
            Localize(placementLabel, "Arrastra el recuadro para colocar el marcador.", "Drag the rectangle to position the marker.");
            placementLabel.SetBounds(12, 451, 446, 22);
            Controls.Add(placementLabel);
            placement.SetBounds(12, 475, 446, 87);
            placement.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom;
            placement.BackColor = Color.FromArgb(32, 40, 45);
            placement.Cursor = Cursors.SizeAll;
            placement.Paint += DrawPlacement;
            placement.MouseDown += (_, e) => { if (e.Button == MouseButtons.Left) { placement.Capture = true; PositionMarker(e.Location); } };
            placement.MouseMove += (_, e) => { if (placement.Capture && e.Button == MouseButtons.Left) PositionMarker(e.Location); };
            placement.MouseUp += (_, _) => placement.Capture = false;
            Controls.Add(placement);
            Shown += (_, _) => { Render(); marker.Show(); };
            FormClosed += (_, _) => marker.Close();
        }

        private string T(string es, string en) => spanish ? es : en;

        private void Localize(Control control, string es, string en)
        {
            translations.Add((control, es, en));
            control.Text = T(es, en);
        }

        private void ChangeLanguage(bool useSpanish)
        {
            spanish = useSpanish;
            Text = T("Control del overlay · Fortnite Chest Analyzer", "Overlay controls · Fortnite Chest Analyzer");
            foreach (var (control, es, en) in translations) control.Text = T(es, en);
            foreach (var control in Controls.Cast<Control>())
                if (control.Tag is ValueTuple<string, string> names) control.AccessibleName = T(names.Item1, names.Item2);
            LocalizeTreasureView();
            folderPath.AccessibleName = T("Carpeta vigilada", "Watched folder");
            folderPath.PlaceholderText = T("Ninguna carpeta seleccionada", "No folder selected");
            if (current is { } snapshot && snapshot.Generation == feed.Generation) Update(snapshot);
            else
            {
                status.Text = folderPath.Text.Length == 0 ? T("Selecciona la carpeta de repeticiones.", "Select your replay folder.")
                    : T("Leyendo la carpeta…", "Reading the folder…");
                Render();
            }
        }

        private void LocalizeTreasureView()
        {
            var selected = Math.Max(0, treasureView.SelectedIndex);
            treasureView.AccessibleName = T("Datos que muestra Tesoros", "Data shown in Treasures");
            treasureView.Items.Clear();
            treasureView.Items.AddRange([T("Todo", "All"), T("Premios del escuadrón", "Squad rewards"),
                T("Registros de premio", "Reward records"), T("Artilugios observados", "Observed gizmos")]);
            treasureView.SelectedIndex = selected;
        }

        private CheckBox AddOption(int x, int y, string es, string en, bool initial)
        {
            var option = new CheckBox { AutoSize = true, Checked = initial, Location = new Point(x, y) };
            Localize(option, es, en);
            option.CheckedChanged += (_, _) => Render();
            Controls.Add(option);
            return option;
        }

        private CheckBox AddScopeOption(int x, int y, string es, string en, bool initial)
        {
            var option = new CheckBox { Checked = initial, Location = new Point(x, y), Size = new Size(20, 20), AccessibleName = T(es, en), Tag = (es, en) };
            option.CheckedChanged += (_, _) => Render();
            Controls.Add(option);
            return option;
        }

        private void AddLabel(int x, int y, int width, string es, string en)
        {
            var label = new Label();
            label.SetBounds(x, y, width, 22);
            Localize(label, es, en);
            Controls.Add(label);
        }

        private NumericUpDown AddNumber(int x, int y, int min, int max, int initial, int step, string es, string en)
        {
            var field = new NumericUpDown { Minimum = min, Maximum = max, Value = initial, Increment = step, AccessibleName = T(es, en), Tag = (es, en) };
            field.SetBounds(x, y, 65, 25);
            field.ValueChanged += (_, _) => Render();
            Controls.Add(field);
            return field;
        }

        private void ChooseFolder()
        {
            var suggested = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "FortniteGame", "Saved", "Demos");
            using var picker = new FolderBrowserDialog { Description = T("Carpeta de repeticiones", "Replay folder") };
            var initial = folderPath.Text.Length > 0 ? folderPath.Text : suggested;
            if (Directory.Exists(initial)) picker.InitialDirectory = initial;
            if (picker.ShowDialog(this) == DialogResult.OK) BeginWatching(picker.SelectedPath);
        }

        private void BeginWatching(string path)
        {
            folderPath.Text = path;
            status.Text = T("Leyendo la carpeta…", "Reading the folder…");
            Render();
            feed.Watch(path);
        }

        internal void ShowError(string english)
        {
            status.Text = !spanish ? english
                : english.Contains("WebView2 Runtime", StringComparison.Ordinal) ? "El overlay independiente requiere Microsoft Edge WebView2 Runtime."
                : "El motor web no está disponible o se ha interrumpido.";
            Render();
        }

        internal void Update(Counters snapshot)
        {
            if (snapshot.Generation != feed.Generation) return;
            current = snapshot;
            if (snapshot.Unread < 0)
            {
                status.Text = T("No se pudo vigilar la carpeta.", "Could not watch the folder.");
                Render();
                return;
            }
            status.Text = T($"{snapshot.Found} en disco · {snapshot.History.Matches} partidas conservadas · {snapshot.Unread} sin leer",
                $"{snapshot.Found} on disk · {snapshot.History.Matches} matches kept · {snapshot.Unread} unread")
                + Environment.NewLine + T($"{snapshot.Live} en curso · {snapshot.Copies} copias",
                    $"{snapshot.Live} live · {snapshot.Copies} copies");
            if (snapshot.Pending > 0)
                status.Text += Environment.NewLine + T($"Leyendo {snapshot.Pending} archivos…", $"Reading {snapshot.Pending} files…");
            Render();
        }

        private void Render()
        {
            static Scope ReadScope(CheckBox[] options) => new(options[0].Checked, options[1].Checked, options[2].Checked, options[3].Checked);
            marker.Render(spanish, new Sections(ReadScope(historyOptions), ReadScope(sessionOptions), showLast.Checked, showStatus.Checked,
                showRecorder.Checked, showMates.Checked, showTeam.Checked, (int)topLimit.Value, sizePercent.Value,
                useCustomWidth.Checked ? (int)customWidth.Value : null, useCustomHeight.Checked ? (int)customHeight.Value : null,
                (TreasureMode)treasureView.SelectedIndex),
                current, status.Text);
            placement.Invalidate();
        }

        private void PositionMarker(Point point)
        {
            var desktop = SystemInformation.VirtualScreen;
            var position = new Point(desktop.Left + point.X * desktop.Width / placement.Width,
                desktop.Top + point.Y * desktop.Height / placement.Height);
            var screen = Screen.FromPoint(position).WorkingArea;
            marker.Location = new Point(Math.Clamp(position.X - marker.Width / 2, screen.Left, Math.Max(screen.Left, screen.Right - marker.Width)),
                Math.Clamp(position.Y - marker.Height / 2, screen.Top, Math.Max(screen.Top, screen.Bottom - marker.Height)));
            placement.Invalidate();
        }

        private void DrawPlacement(object? sender, PaintEventArgs e)
        {
            var desktop = SystemInformation.VirtualScreen;
            Rectangle Scale(Rectangle bounds) => new(
                (bounds.Left - desktop.Left) * placement.Width / desktop.Width,
                (bounds.Top - desktop.Top) * placement.Height / desktop.Height,
                Math.Max(2, bounds.Width * placement.Width / desktop.Width),
                Math.Max(2, bounds.Height * placement.Height / desktop.Height));
            foreach (var screen in Screen.AllScreens) e.Graphics.DrawRectangle(Pens.Gray, Scale(screen.Bounds));
            e.Graphics.FillRectangle(Brushes.LightGreen, Scale(marker.Bounds));
        }
    }

    private sealed class Marker : Form
    {
        private sealed record Line(string Label, string Value, bool Heading = false);
        private sealed record Card(string Title, Color Accent, Line[] Lines);
        private readonly List<(Card Card, Rectangle Bounds)> cards = [];
        private Font heading = new("Segoe UI", 10, FontStyle.Bold);
        private Font labelFont = new("Segoe UI", 8.5f);
        private Font valueFont = new("Segoe UI", 9, FontStyle.Bold);
        private float scale = 1;
        private float scaleX = 1;
        private float scaleY = 1;
        private nint foregroundHook;
        private GCHandle foregroundCallback;
        private const uint ForegroundChanged = 0x0003;
        private string title;

        internal Marker(bool spanish)
        {
            title = spanish ? "COFRES" : "CHESTS";
            Text = "Fortnite Chest Analyzer";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            ShowInTaskbar = false;
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(350, 109);
            var screen = Screen.PrimaryScreen!.WorkingArea;
            Location = new Point(screen.Left + 18, screen.Top + Math.Max(56, screen.Height * 8 / 100));
            BackColor = Color.FromArgb(22, 29, 33);
            ForeColor = Color.WhiteSmoke;
            DoubleBuffered = true;
        }

        protected override bool ShowWithoutActivation => true;
        protected override CreateParams CreateParams
        {
            get
            {
                var parameters = base.CreateParams;
                parameters.ExStyle |= 0x20 | 0x80 | 0x80000 | 0x08000000; // Transparent, tool window, layered, no activation.
                return parameters;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            SetLayeredWindowAttributes(Handle, 0, 255, 2);
            WinEventCallback callback = (_, _, _, _, _, _, _) => KeepAbove();
            foregroundCallback = GCHandle.Alloc(callback);
            foregroundHook = SetWinEventHook(ForegroundChanged, ForegroundChanged, 0, callback, 0, 0, 0x0002);
            KeepAbove();
        }

        protected override void OnHandleDestroyed(EventArgs e)
        {
            if (foregroundHook != 0)
            {
                UnhookWinEvent(foregroundHook);
                foregroundHook = 0;
            }
            if (foregroundCallback.IsAllocated) foregroundCallback.Free();
            base.OnHandleDestroyed(e);
        }

        protected override void OnVisibleChanged(EventArgs e)
        {
            base.OnVisibleChanged(e);
            KeepAbove();
        }

        private void KeepAbove()
        {
            if (Visible && IsHandleCreated)
                SetWindowPos(Handle, -1, 0, 0, 0, 0, 0x0013); // HWND_TOPMOST, keep position and size, never activate.
        }

        internal void Render(bool spanish, Sections options, Counters? snapshot, string message)
        {
            string T(string es, string en) => spanish ? es : en;
            var culture = CultureInfo.GetCultureInfo(spanish ? "es-ES" : "en-US");
            string Number(long? count) => count?.ToString("N0", culture) ?? "—";
            string Average(RoleTotal? value) => value is { Total: { } sum, Games: > 0 }
                ? $"{(sum / (double)value.Games).ToString("N1", culture)} · {value.Games} {T("p.", "g.")}" : "—";
            Line[] Roles(string recorder, string mates, string team) =>
            [
                .. (options.Recorder ? new[] { new Line(T("Grabador", "Recorder"), recorder) } : []),
                .. (options.Mates ? new[] { new Line(T("Compañeros", "Teammates"), mates) } : []),
                .. (options.Team ? new[] { new Line(T("Escuadrón", "Full squad"), team) } : []),
            ];

            Line[] Unassigned(long? count) => count is > 0
                ? [new Line(T("Rotos sin equipo", "Broken · unknown team"), Number(count))] : [];
            Card ChestCard(string label, Color color, Period? period) => new(label, color,
                [new Line(T("Partidas", "Matches"), Number(period?.Matches)),
                    .. Roles(Number(period?.Recorder?.Total), Number(period?.Mates?.Total), Number(period?.Team?.Total)),
                    .. Unassigned(period?.Unassigned)]);
            Card AverageCard(string label, Color color, Period? period) => new(label, color,
                Roles(Average(period?.Recorder), Average(period?.Mates), Average(period?.Team)));
            Card RewardCard(string label, Period? period)
            {
                var lines = new List<Line>();
                void AddEvidence(string title, Reward[]? rows)
                {
                    lines.Add(new Line(title, "", true));
                    if (rows is not { Length: > 0 }) lines.Add(new Line(T("Sin registros visibles", "No records observed"), "—"));
                    else lines.AddRange(rows.Select(reward => new Line(spanish ? reward.Spanish : reward.English, Number(reward.Count))));
                }
                if (options.TreasureView is TreasureMode.All or TreasureMode.Squad)
                    AddEvidence(T("Premios del escuadrón", "Squad rewards"), period?.Rewards);
                if (options.TreasureView is TreasureMode.All or TreasureMode.Records)
                    AddEvidence(T("Registros de premio", "Reward records"), period?.RewardRecords);
                if (options.TreasureView is TreasureMode.All or TreasureMode.Actors)
                    AddEvidence(T("Artilugios observados", "Observed gizmos"), period?.GizmoActors);
                return new Card(label, Color.FromArgb(215, 179, 249), [.. lines]);
            }
            Card TopCard(string label, Period? period) => new(label, Color.FromArgb(255, 208, 112),
                period?.Top is { Length: > 0 } ranks
                    ? ranks.Take(options.TopLimit).Select((player, index) => new Line(
                        $"{index + 1}. {player.Name ?? T("Jugador sin nombre", "Unnamed player")}", Number(player.Opened))).ToArray()
                    : [new Line(T("Sin aperturas atribuidas", "No attributed openings"), "—")]);

            var green = Color.FromArgb(185, 240, 142);
            var blue = Color.FromArgb(133, 210, 247);
            var silver = Color.FromArgb(185, 201, 210);
            var width = options.CustomWidth ?? (options.History.Treasures || options.Session.Treasures || options.History.Top || options.Session.Top ? 462 : 350);
            var columns = width < 320 ? 1 : 2;
            var half = (width - 28) / 2;
            var y = 34;
            cards.Clear();
            title = T("▣  COFRES ABIERTOS O ROTOS", "▣  CHESTS OPENED OR BROKEN");

            void AddRow(params Card?[] selected)
            {
                foreach (var row in selected.OfType<Card>().Chunk(columns))
                {
                    var height = 31 + Math.Max(1, row.Max(card => card.Lines.Length)) * 19;
                    for (var index = 0; index < row.Length; index++)
                    {
                        var bounds = new Rectangle(10 + index * (half + 8), y, row.Length == 1 ? width - 20 : half, height);
                        cards.Add((row[index], bounds));
                    }
                    y += height + 8;
                }
            }

            var counts = new List<Card>();
            if (options.History.Chests) counts.Add(ChestCard(T("▤ Histórico", "▤ History"), green, snapshot?.History));
            if (options.Session.Chests) counts.Add(ChestCard(T("◷ Sesión", "◷ Session"), blue, snapshot?.Session));
            if (options.Last) counts.Add(new Card(T("↳ Última partida", "↳ Last match"), silver,
                [.. Roles(Number(snapshot?.Last?.Recorder), Number(snapshot?.Last?.Mates), Number(snapshot?.Last?.Team)),
                    .. Unassigned(snapshot?.Last?.Unassigned)]));
            AddRow(counts.ToArray());

            AddRow(options.Session.Average ? AverageCard(T("≈ Media sesión", "≈ Session average"), blue, snapshot?.Session) : null,
                options.History.Average ? AverageCard(T("≈ Media histórica", "≈ History average"), green, snapshot?.History) : null);
            AddRow(options.Session.Treasures ? RewardCard(T("◆ Tesoros sesión", "◆ Session treasures"), snapshot?.Session) : null,
                options.History.Treasures ? RewardCard(T("◆ Tesoros histórico", "◆ History treasures"), snapshot?.History) : null);
            AddRow(options.Session.Top ? TopCard(T("★ Top sesión", "★ Session rankings"), snapshot?.Session) : null,
                options.History.Top ? TopCard(T("★ Top histórico", "★ History rankings"), snapshot?.History) : null);
            if (options.Status)
                AddRow(new Card(T("○ Estado de lectura", "○ Reading status"), silver,
                    message.Split(Environment.NewLine).Select(line => new Line(line, "")).ToArray()));

            var screen = Screen.FromRectangle(Bounds).WorkingArea;
            var height = options.CustomHeight ?? y;
            var requestedScale = options.SizePercent / 100f;
            if (options.CustomHeight is null && options.CustomWidth is null)
                requestedScale = Math.Min(requestedScale, Math.Min(screen.Width / (float)width, screen.Height / (float)height));
            scaleX = Math.Min(requestedScale, screen.Width / (float)width);
            var windowHeight = Math.Min(screen.Height, (int)Math.Round(height * requestedScale));
            scaleY = Math.Min(requestedScale, windowHeight / (float)y);
            SetScale(Math.Min(scaleX, scaleY));
            ClientSize = new Size(X(width), windowHeight);
            Location = new Point(Math.Clamp(Left, screen.Left, Math.Max(screen.Left, screen.Right - Width)),
                Math.Clamp(Top, screen.Top, Math.Max(screen.Top, screen.Bottom - Height)));
            KeepAbove();
            Invalidate();
        }

        private void SetScale(float next)
        {
            if (scale == next) return;
            scale = next;
            heading.Dispose();
            labelFont.Dispose();
            valueFont.Dispose();
            heading = new Font("Segoe UI", 10 * scale, FontStyle.Bold);
            labelFont = new Font("Segoe UI", 8.5f * scale);
            valueFont = new Font("Segoe UI", 9 * scale, FontStyle.Bold);
        }

        private int X(int value) => (int)Math.Round(value * scaleX);
        private int Y(int value) => (int)Math.Round(value * scaleY);
        private Rectangle Scaled(Rectangle bounds) => new(X(bounds.X), Y(bounds.Y), X(bounds.Width), Y(bounds.Height));

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            var flags = TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix;
            TextRenderer.DrawText(e.Graphics, title, heading, new Rectangle(X(12), Y(8), ClientSize.Width - X(24), Y(24)), ForeColor, flags);
            using var background = new SolidBrush(Color.FromArgb(30, 39, 44));
            foreach (var (card, bounds) in cards)
            {
                e.Graphics.FillRectangle(background, Scaled(bounds));
                TextRenderer.DrawText(e.Graphics, card.Title, heading, Scaled(new Rectangle(bounds.X + 8, bounds.Y + 5, bounds.Width - 16, 22)), card.Accent, flags);
                for (var index = 0; index < card.Lines.Length; index++)
                {
                    var line = card.Lines[index];
                    var y = bounds.Y + 28 + index * 19;
                    var valueWidth = line.Value.Length == 0 ? 0 : Math.Max(X(38), TextRenderer.MeasureText(line.Value, valueFont).Width);
                    TextRenderer.DrawText(e.Graphics, line.Label, line.Heading ? valueFont : labelFont, new Rectangle(X(bounds.X + 8), Y(y),
                        Math.Max(0, X(bounds.Width - 16) - valueWidth), Y(19)), line.Heading ? card.Accent : ForeColor, flags);
                    if (valueWidth > 0)
                        TextRenderer.DrawText(e.Graphics, line.Value, valueFont, new Rectangle(X(bounds.Right - 8) - valueWidth,
                            Y(y), valueWidth, Y(19)), card.Accent, flags | TextFormatFlags.Right);
                }
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                heading.Dispose();
                labelFont.Dispose();
                valueFont.Dispose();
            }
            base.Dispose(disposing);
        }

        [DllImport("user32.dll")]
        private static extern bool SetLayeredWindowAttributes(nint window, uint key, byte alpha, uint flags);

        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(nint window, nint insertAfter, int x, int y, int width, int height, uint flags);

        private delegate void WinEventCallback(nint hook, uint eventType, nint window, int obj, int child, uint thread, uint time);

        [DllImport("user32.dll")]
        private static extern nint SetWinEventHook(uint min, uint max, nint module, WinEventCallback callback, uint process, uint thread, uint flags);

        [DllImport("user32.dll")]
        private static extern bool UnhookWinEvent(nint hook);
    }
}
