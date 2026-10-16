using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

// This process owns its Raw Input registration and message loop. Only aggregated
// counts and timing leave it; key codes and pointer coordinates never do.
public sealed class BAInputPolicy
{
    private readonly Dictionary<IntPtr, HashSet<int>> pressed = new Dictionary<IntPtr, HashSet<int>>();
    private static readonly int[] buttonDownFlags = { 1, 4, 16, 64, 256 };

    public bool Key(IntPtr device, int makeCode, int flags, int virtualKey)
    {
        if (makeCode == 0xff || virtualKey >= 0xff) return false;
        HashSet<int> keys;
        if (!pressed.TryGetValue(device, out keys))
        {
            keys = new HashSet<int>();
            pressed.Add(device, keys);
        }
        int key = makeCode == 0 ? virtualKey + 65536 : (makeCode << 3) | (flags & 6);
        if ((flags & 1) != 0) { keys.Remove(key); return false; }
        return keys.Add(key);
    }
    public static int Mouse(int flags)
    {
        int count = 0;
        foreach (int down in buttonDownFlags) if ((flags & down) != 0) count++;
        return count;
    }
    public void RemoveDevice(IntPtr device) { pressed.Remove(device); }
}

public sealed class BAInputMonitor : NativeWindow, IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    private struct RawDevice
    {
        public ushort UsagePage;
        public ushort Usage;
        public uint Flags;
        public IntPtr Target;
    }
    private delegate void ForegroundCallback(IntPtr hook, uint eventType, IntPtr window,
        int objectId, int childId, uint threadId, uint eventTime);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterRawInputDevices(RawDevice[] devices, uint count, uint size);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetRawInputData(IntPtr input, uint command, IntPtr data,
        ref uint size, uint headerSize);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWinEventHook(uint minimum, uint maximum, IntPtr module,
        ForegroundCallback callback, uint processId, uint threadId, uint flags);
    [DllImport("user32.dll")]
    private static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    private readonly Stopwatch clock = new Stopwatch();
    private readonly BAInputPolicy policy = new BAInputPolicy();
    private readonly Dictionary<long, long> counts = new Dictionary<long, long>();
    private readonly HashSet<long> dirty = new HashSet<long>();
    private readonly ForegroundCallback foregroundCallback;
    private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    private readonly uint headerSize = (uint)(8 + 2 * IntPtr.Size);
    private IntPtr rawBuffer = IntPtr.Zero;
    private uint capacity;
    private IntPtr foreground;
    private IntPtr foregroundHook;
    private bool focused;
    private long focusAt;
    private long focusedMs;
    private bool disposed;

    private BAInputMonitor()
    {
        foregroundCallback = OnForeground;
        try
        {
            CreateParams parameters = new CreateParams();
            parameters.Caption = "Broken Arrow input collector";
            parameters.Parent = new IntPtr(-3); // HWND_MESSAGE: no visible window.
            CreateHandle(parameters);
            RawDevice[] devices = Devices(0x00002100, Handle); // INPUTSINK | DEVNOTIFY.
            if (!RegisterRawInputDevices(devices, (uint)devices.Length,
                (uint)Marshal.SizeOf(typeof(RawDevice))))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            foregroundHook = SetWinEventHook(3, 3, IntPtr.Zero, foregroundCallback, 0, 0, 0);
            if (foregroundHook == IntPtr.Zero)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            clock.Start();
            RefreshFocus();
            Flush("ready");
            timer.Interval = 250;
            timer.Tick += delegate { Flush("sample"); };
            timer.Start();
            IntPtr target = Handle;
            Thread reader = new Thread(delegate()
            {
                // EOF also stops capture when the parent application exits.
                while (true)
                {
                    string command = Console.ReadLine();
                    if (command == null || command == "stop") break;
                }
                PostMessage(target, 0x8001, IntPtr.Zero, IntPtr.Zero);
            });
            reader.IsBackground = true;
            reader.Start();
        }
        catch
        {
            Dispose();
            throw;
        }
    }
    private static RawDevice[] Devices(uint flags, IntPtr target)
    {
        return new RawDevice[] {
            new RawDevice { UsagePage = 1, Usage = 6, Flags = flags, Target = target },
            new RawDevice { UsagePage = 1, Usage = 2, Flags = flags, Target = target }
        };
    }
    private void OnForeground(IntPtr hook, uint eventType, IntPtr window,
        int objectId, int childId, uint threadId, uint eventTime)
    {
        RefreshFocus();
    }
    private void AccumulateFocus()
    {
        long now = clock.ElapsedMilliseconds;
        if (focused) focusedMs += now - focusAt;
        focusAt = now;
    }
    private void RefreshFocus()
    {
        IntPtr window = GetForegroundWindow();
        if (window == foreground && window != IntPtr.Zero) return;
        AccumulateFocus();
        foreground = window;
        focused = false;
        uint processId;
        GetWindowThreadProcessId(window, out processId);
        try
        {
            using (Process process = Process.GetProcessById((int)processId))
            {
                string name = process.ProcessName.Replace("_", "").Replace(" ", "");
                focused = name.Equals("BrokenArrow", StringComparison.OrdinalIgnoreCase)
                    || name.Equals("BrokenArrowBeta", StringComparison.OrdinalIgnoreCase);
            }
        }
        catch (ArgumentException) { }
        catch (InvalidOperationException) { }
        catch (Win32Exception) { }
    }
    private void Count()
    {
        // Check focus at each counted input as well as on foreground notifications.
        RefreshFocus();
        if (!focused) return;
        long second = clock.ElapsedMilliseconds / 1000;
        long value;
        counts.TryGetValue(second, out value);
        counts[second] = value + 1;
        dirty.Add(second);
    }
    private void ReadInput(IntPtr input)
    {
        uint size = 0;
        if (GetRawInputData(input, 0x10000003, IntPtr.Zero, ref size, headerSize) == uint.MaxValue)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        if (size < headerSize || size > 1048576) throw new InvalidOperationException("Invalid input size");
        if (size > capacity)
        {
            if (rawBuffer != IntPtr.Zero) Marshal.FreeHGlobal(rawBuffer);
            rawBuffer = IntPtr.Zero;
            rawBuffer = Marshal.AllocHGlobal((int)size);
            capacity = size;
        }
        if (GetRawInputData(input, 0x10000003, rawBuffer, ref size, headerSize) == uint.MaxValue)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        int type = Marshal.ReadInt32(rawBuffer);
        IntPtr device = Marshal.ReadIntPtr(rawBuffer, 8);
        int offset = (int)headerSize;
        if (type == 1 && size >= headerSize + 16)
        {
            int makeCode = (ushort)Marshal.ReadInt16(rawBuffer, offset);
            int flags = (ushort)Marshal.ReadInt16(rawBuffer, offset + 2);
            int virtualKey = (ushort)Marshal.ReadInt16(rawBuffer, offset + 6);
            if (policy.Key(device, makeCode, flags, virtualKey)) Count();
        }
        else if (type == 0 && size >= headerSize + 24)
        {
            int flags = (ushort)Marshal.ReadInt16(rawBuffer, offset + 4);
            // Mouse releases, movement and wheel do not count.
            int actions = BAInputPolicy.Mouse(flags);
            for (int index = 0; index < actions; index++) Count();
        }
    }
    private void Flush(string type)
    {
        AccumulateFocus();
        StringBuilder message = new StringBuilder();
        message.Append("{\"type\":\"").Append(type).Append("\",\"elapsedMs\":")
            .Append(clock.ElapsedMilliseconds.ToString(CultureInfo.InvariantCulture))
            .Append(",\"focusedMs\":").Append(focusedMs.ToString(CultureInfo.InvariantCulture))
            .Append(",\"focused\":").Append(focused ? "true" : "false").Append(",\"seconds\":[");
        bool separator = false;
        foreach (long second in dirty)
        {
            if (separator) message.Append(',');
            message.Append('[').Append(second.ToString(CultureInfo.InvariantCulture)).Append(',')
                .Append(counts[second].ToString(CultureInfo.InvariantCulture)).Append(']');
            separator = true;
        }
        message.Append("]}");
        Console.WriteLine(message.ToString());
        Console.Out.Flush();
        dirty.Clear();
    }
    protected override void WndProc(ref Message message)
    {
        try
        {
            if (message.Msg == 0xff) ReadInput(message.LParam);
            else if (message.Msg == 0xfe && message.WParam.ToInt64() == 2)
                policy.RemoveDevice(message.LParam);
            else if (message.Msg == 0x8001)
            {
                RefreshFocus();
                Flush("stopped");
                Application.ExitThread();
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            Environment.ExitCode = 1;
            Application.ExitThread();
        }
        base.WndProc(ref message);
    }
    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        timer.Dispose();
        if (foregroundHook != IntPtr.Zero) UnhookWinEvent(foregroundHook);
        if (Handle != IntPtr.Zero)
        {
            RawDevice[] devices = Devices(1, IntPtr.Zero); // RIDEV_REMOVE.
            RegisterRawInputDevices(devices, (uint)devices.Length, (uint)Marshal.SizeOf(typeof(RawDevice)));
            DestroyHandle();
        }
        if (rawBuffer != IntPtr.Zero) Marshal.FreeHGlobal(rawBuffer);
    }
    [STAThread]
    public static void Run()
    {
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
        using (BAInputMonitor monitor = new BAInputMonitor()) Application.Run();
    }
}
