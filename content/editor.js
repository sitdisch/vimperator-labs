/***** BEGIN LICENSE BLOCK ***** {{{
Version: MPL 1.1/GPL 2.0/LGPL 2.1

The contents of this file are subject to the Mozilla Public License Version
1.1 (the "License"); you may not use this file except in compliance with
the License. You may obtain a copy of the License at
http://www.mozilla.org/MPL/

Software distributed under the License is distributed on an "AS IS" basis,
WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
for the specific language governing rights and limitations under the
License.

(c) 2006-2008: Martin Stubenschrott <stubenschrott@gmx.net>

Alternatively, the contents of this file may be used under the terms of
either the GNU General Public License Version 2 or later (the "GPL"), or
the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
in which case the provisions of the GPL or the LGPL are applicable instead
of those above. If you wish to allow use of your version of this file only
under the terms of either the GPL or the LGPL, and not to allow others to
use your version of this file under the terms of the MPL, indicate your
decision by deleting the provisions above and replace them with the notice
and other provisions required by the GPL or the LGPL. If you do not delete
the provisions above, a recipient may use your version of this file under
the terms of any one of the MPL, the GPL or the LGPL.
}}} ***** END LICENSE BLOCK *****/

// command names taken from:
// http://developer.mozilla.org/en/docs/Editor_Embedding_Guide

liberator.Editor = function () //{{{
{
    ////////////////////////////////////////////////////////////////////////////////
    ////////////////////// PRIVATE SECTION /////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////{{{

    // store our last search with f, F, t or T
    var lastFindChar = null;
    var lastFindCharFunc = null;
    var abbrev = {}; // abbrev["lhr"][0]["{i,c,!}","rhs"]

    function editor()
    {
        return window.document.commandDispatcher.focusedElement;
    }

    function getController()
    {
        var ed = editor();
        if (!ed || !ed.controllers)
            return null;

        return ed.controllers.getControllerForCommand("cmd_beginLine");
    }

    function selectPreviousLine()
    {
        liberator.editor.executeCommand("cmd_selectLinePrevious");
        if ((liberator.modes.extended & liberator.modes.LINE) && !liberator.editor.selectedText())
            liberator.editor.executeCommand("cmd_selectLinePrevious");
    }
    function selectNextLine()
    {
        liberator.editor.executeCommand("cmd_selectLineNext");
        if ((liberator.modes.extended & liberator.modes.LINE) && !liberator.editor.selectedText())
            liberator.editor.executeCommand("cmd_selectLineNext");
    }

    // add mappings for commands like h,j,k,l,etc. in CARET, VISUAL and TEXTAREA mode
    function addMovementMap(keys, hasCount, caretModeMethod, caretModeArg, textareaCommand, visualTextareaCommand)
    {
        var extraInfo = {};
        if (hasCount)
            extraInfo.flags = liberator.Mappings.flags.COUNT;

        liberator.mappings.add([liberator.modes.CARET], keys, "",
            function (count)
            {
                if (typeof count != "number" || count < 1)
                    count = 1;

                var controller = getBrowser().docShell
                                 .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                                 .getInterface(Components.interfaces.nsISelectionDisplay)
                                 .QueryInterface(Components.interfaces.nsISelectionController);

                 while (count--)
                     controller[caretModeMethod](caretModeArg, false);
            },
            extraInfo);

        liberator.mappings.add([liberator.modes.VISUAL], keys, "",
            function (count)
            {
                if (typeof count != "number" || count < 1 || !hasCount)
                    count = 1;

                var controller = getBrowser().docShell
                                 .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                                 .getInterface(Components.interfaces.nsISelectionDisplay)
                                 .QueryInterface(Components.interfaces.nsISelectionController);

                while (count--)
                {
                    if (liberator.modes.extended & liberator.modes.TEXTAREA)
                    {
                        if (typeof visualTextareaCommand == "function")
                            visualTextareaCommand();
                        else
                            liberator.editor.executeCommand(visualTextareaCommand);
                    }
                    else
                        controller[caretModeMethod](caretModeArg, true);
                }
            },
            extraInfo);

        liberator.mappings.add([liberator.modes.TEXTAREA], keys, "",
            function (count)
            {
                if (typeof count != "number" || count < 1)
                    count = 1;

                liberator.editor.executeCommand(textareaCommand, count);
            },
            extraInfo);
    }

    // add mappings for commands like i,a,s,c,etc. in TEXTAREA mode
    function addBeginInsertModeMap(keys, commands)
    {
        liberator.mappings.add([liberator.modes.TEXTAREA], keys, "",
            function (count)
            {
                for (let c = 0; c < commands.length; c++)
                    liberator.editor.executeCommand(commands[c], 1);

                liberator.modes.set(liberator.modes.INSERT, liberator.modes.TEXTAREA);
            });
    }

    function addMotionMap(key)
    {
        liberator.mappings.add([liberator.modes.TEXTAREA], [key],
            "Motion command",
            function (motion, count) { liberator.editor.executeCommandWithMotion(key, motion, count); },
            { flags: liberator.Mappings.flags.MOTION | liberator.Mappings.flags.COUNT });
    }

    // mode = "i" -> add :iabbrev, :iabclear and :iunabbrev commands
    function addAbbreviationCommands(char, modeDescription)
    {
        var modeDescription = modeDescription ? " in " + modeDescription + " mode" : "";
        var mode = char || "!";

        liberator.commands.add([char ? char + "a[bbrev]" : "ab[breviate]"],
            "Abbreviate a key sequence" + modeDescription,
            function (args)
            {
                if (!args)
                {
                    liberator.editor.listAbbreviations(mode, "");
                    return;
                }

                var matches = args.match(/^([^\s]+)(?:\s+(.+))?$/);
                var [lhs, rhs] = [matches[1], matches[2]];
                if (rhs)
                    liberator.editor.addAbbreviation(mode, lhs, rhs);
                else
                    liberator.editor.listAbbreviations(mode, lhs);
            });

        liberator.commands.add([char ? char + "una[bbrev]" : "una[bbreviate]"],
            "Remove an abbreviation" + modeDescription,
            function (args) { liberator.editor.removeAbbreviation(mode, args); });

        liberator.commands.add([char + "abc[lear]"],
            "Remove all abbreviations" + modeDescription,
            function (args) { liberator.editor.removeAllAbbreviations(mode); });
    }

    /////////////////////////////////////////////////////////////////////////////}}}
    ////////////////////// OPTIONS /////////////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////{{{
    
    liberator.options.add(["editor"],
        "Set the external text editor",
        "string", "gvim -f");

    liberator.options.add(["insertmode", "im"],
        "Use Insert mode as the default for text areas",
        "boolean", true);

    /////////////////////////////////////////////////////////////////////////////}}}
    ////////////////////// MAPPINGS ////////////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////{{{

    var modes = [liberator.modes.INSERT, liberator.modes.COMMAND_LINE];

    /*             KEYS                          COUNT  CARET                   TEXTAREA            VISUAL_TEXTAREA */
    addMovementMap(["k", "<Up>"],                true,  "lineMove", false,      "cmd_linePrevious", selectPreviousLine);
    addMovementMap(["j", "<Down>", "<Return>"],  true,  "lineMove", true,       "cmd_lineNext",     selectNextLine);
    addMovementMap(["h", "<Left>", "<BS>"],      true,  "characterMove", false, "cmd_charPrevious", "cmd_selectCharPrevious");
    addMovementMap(["l", "<Right>", "<Space>"],  true,  "characterMove", true,  "cmd_charNext",     "cmd_selectCharNext");
    addMovementMap(["b", "B", "<C-Left>"],       true,  "wordMove", false,      "cmd_wordPrevious", "cmd_selectWordPrevious");
    addMovementMap(["w", "W", "e", "<C-Right>"], true,  "wordMove", true,       "cmd_wordNext",     "cmd_selectWordNext");
    addMovementMap(["<C-f>", "<PageDown>"],      true,  "pageMove", true,       "cmd_movePageDown", "cmd_selectNextPage");
    addMovementMap(["<C-b>", "<PageUp>"],        true,  "pageMove", false,      "cmd_movePageUp",   "cmd_selectPreviousPage");
    addMovementMap(["gg", "<C-Home>"],           false, "completeMove", false,  "cmd_moveTop",      "cmd_selectTop");
    addMovementMap(["G", "<C-End>"],             false, "completeMove", true,   "cmd_moveBottom",   "cmd_selectBottom");
    addMovementMap(["0", "^", "<Home>"],         false, "intraLineMove", false, "cmd_beginLine",    "cmd_selectBeginLine");
    addMovementMap(["$", "<End>"],               false, "intraLineMove", true,  "cmd_endLine" ,     "cmd_selectEndLine" );

    addBeginInsertModeMap(["i", "<Insert"], []);
    addBeginInsertModeMap(["a"],            ["cmd_charNext"]);
    addBeginInsertModeMap(["I", "gI"],      ["cmd_beginLine"]);
    addBeginInsertModeMap(["A"],            ["cmd_endLine"]);
    addBeginInsertModeMap(["s"],            ["cmd_deleteCharForward"]);
    addBeginInsertModeMap(["S"],            ["cmd_deleteToEndOfLine", "cmd_deleteToBeginningOfLine"]);
    addBeginInsertModeMap(["C"],            ["cmd_deleteToEndOfLine"]);

    addMotionMap("d"); // delete
    addMotionMap("c"); // change
    addMotionMap("y"); // yank

    // insert mode mappings
    liberator.mappings.add(modes,
        ["<C-w>"], "Delete previous word",
        function () { liberator.editor.executeCommand("cmd_deleteWordBackward", 1); });

    liberator.mappings.add(modes,
        ["<C-u>"], "Delete until beginning of current line",
        function ()
        {
            // broken in FF3, deletes the whole line:
            // liberator.editor.executeCommand("cmd_deleteToBeginningOfLine", 1);
            liberator.editor.executeCommand("cmd_selectBeginLine", 1);
            if (getController().isCommandEnabled("cmd_delete"))
                liberator.editor.executeCommand("cmd_delete", 1);
        });

    liberator.mappings.add(modes,
        ["<C-k>"], "Delete until end of current line",
        function () { liberator.editor.executeCommand("cmd_deleteToEndOfLine", 1); });

    liberator.mappings.add(modes,
        ["<C-a>", "<Home>"], "Move cursor to beginning of current line",
        function () { liberator.editor.executeCommand("cmd_beginLine", 1); });

    liberator.mappings.add(modes,
        ["<C-e>", "<End>"], "Move cursor to end of current line",
        function () { liberator.editor.executeCommand("cmd_endLine", 1); });

    liberator.mappings.add(modes,
        ["<C-h>"], "Delete character to the left",
        function () { liberator.editor.executeCommand("cmd_deleteCharBackward", 1); });

    liberator.mappings.add(modes,
        ["<C-d>"], "Delete character to the right",
        function () { liberator.editor.executeCommand("cmd_deleteCharForward", 1); });

    liberator.mappings.add(modes,
        ["<S-Insert>"], "Insert clipboard/selection",
        function () { liberator.editor.pasteClipboard(); });

    liberator.mappings.add([liberator.modes.INSERT, liberator.modes.TEXTAREA, liberator.modes.COMPOSE],
        ["<C-i>"], "Edit text field with an external editor",
        function () { liberator.editor.editWithExternalEditor(); });

    // FIXME: <esc> does not work correctly
    liberator.mappings.add([liberator.modes.INSERT],
        ["<C-t>"], "Edit text field in vi mode",
        function () { liberator.mode = liberator.modes.TEXTAREA; });

    liberator.mappings.add([liberator.modes.INSERT],
        ["<Space>", "<Return>"], "Expand insert mode abbreviation",
        function () { return liberator.editor.expandAbbreviation("i"); },
        { flags: liberator.Mappings.flags.ALLOW_EVENT_ROUTING });

    liberator.mappings.add([liberator.modes.INSERT],
        ["<Tab>"], "Expand insert mode abbreviation",
        function () { liberator.editor.expandAbbreviation("i"); document.commandDispatcher.advanceFocus(); });

    liberator.mappings.add([liberator.modes.INSERT],
        ["<C-]>", "<C-5>"], "Expand insert mode abbreviation",
        function () { liberator.editor.expandAbbreviation("i"); });

    // textarea mode
    liberator.mappings.add([liberator.modes.TEXTAREA],
        ["u"], "Undo",
        function (count)
        {
            liberator.editor.executeCommand("cmd_undo", count);
            liberator.mode = liberator.modes.TEXTAREA;
        },
        { flags: liberator.Mappings.flags.COUNT });

    liberator.mappings.add([liberator.modes.TEXTAREA],
        ["<C-r>"], "Redo",
        function (count)
        {
            liberator.editor.executeCommand("cmd_redo", count);
            liberator.mode = liberator.modes.TEXTAREA;
        },
        { flags: liberator.Mappings.flags.COUNT });

    liberator.mappings.add([liberator.modes.TEXTAREA],
        ["o"], "Open line below current",
        function (count)
        {
            liberator.editor.executeCommand("cmd_endLine", 1);
            liberator.modes.set(liberator.modes.INSERT, liberator.modes.TEXTAREA);
            liberator.events.feedkeys("<Return>");
        });

    liberator.mappings.add([liberator.modes.TEXTAREA],
        ["O"], "Open line above current",
        function (count)
        {
            liberator.editor.executeCommand("cmd_beginLine", 1);
            liberator.modes.set(liberator.modes.INSERT, liberator.modes.TEXTAREA);
            liberator.events.feedkeys("<Return>");
            liberator.editor.executeCommand("cmd_linePrevious", 1);
        });

    // visual mode
    liberator.mappings.add([liberator.modes.CARET, liberator.modes.TEXTAREA, liberator.modes.VISUAL],
        ["v"], "Start visual mode",
        function (count) { liberator.modes.set(liberator.modes.VISUAL, liberator.mode); });

    liberator.mappings.add([liberator.modes.TEXTAREA],
        ["V"], "Start visual line mode",
        function (count)
        {
            liberator.modes.set(liberator.modes.VISUAL, liberator.modes.TEXTAREA | liberator.modes.LINE);
            liberator.editor.executeCommand("cmd_beginLine", 1);
            liberator.editor.executeCommand("cmd_selectLineNext", 1);
        });

    liberator.mappings.add([liberator.modes.VISUAL],
        ["c", "s"], "Change selected text",
        function (count)
        {
            if (liberator.modes.extended & liberator.modes.TEXTAREA)
            {
                liberator.editor.executeCommand("cmd_cut");
                liberator.modes.set(liberator.modes.INSERT, liberator.modes.TEXTAREA);
            }
            else
                liberator.beep();
        });

    liberator.mappings.add([liberator.modes.VISUAL],
        ["d"], "Delete selected text",
        function (count)
        {
            if (liberator.modes.extended & liberator.modes.TEXTAREA)
            {
                liberator.editor.executeCommand("cmd_cut");
                liberator.modes.set(liberator.modes.TEXTAREA);
            }
            else
                liberator.beep();
        });

    liberator.mappings.add([liberator.modes.VISUAL],
        ["y"], "Yank selected text",
        function (count)
        {
            if (liberator.modes.extended & liberator.modes.TEXTAREA)
            {
                liberator.editor.executeCommand("cmd_copy");
                liberator.modes.set(liberator.modes.TEXTAREA);
            }
            else
            {
                var sel = window.content.document.getSelection();
                if (sel)
                    liberator.util.copyToClipboard(sel, true);
                else
                    liberator.beep();
            }
        });

    liberator.mappings.add([liberator.modes.VISUAL, liberator.modes.TEXTAREA],
        ["p"], "Paste clipboard contents",
        function (count)
        {
            if (!(liberator.modes.extended & liberator.modes.CARET))
            {
                if (!count) count = 1;
                while (count--)
                    liberator.editor.executeCommand("cmd_paste");
                liberator.mode = liberator.modes.TEXTAREA;
            }
            else
                liberator.beep();
        });

    // finding characters
    liberator.mappings.add([liberator.modes.TEXTAREA, liberator.modes.VISUAL],
        ["f"], "Move to a character on the current line after the cursor",
        function (count, arg)
        {
            var pos = liberator.editor.findCharForward(arg, count);
            if (pos >= 0)
                liberator.editor.moveToPosition(pos, true, liberator.mode == liberator.modes.VISUAL);
        },
        { flags: liberator.Mappings.flags.ARGUMENT | liberator.Mappings.flags.COUNT});

    liberator.mappings.add([liberator.modes.TEXTAREA, liberator.modes.VISUAL],
        ["F"], "Move to a charater on the current line before the cursor",
        function (count, arg)
        {
            var pos = liberator.editor.findCharBackward(arg, count);
            if (pos >= 0)
                liberator.editor.moveToPosition(pos, false, liberator.mode == liberator.modes.VISUAL);
        },
        { flags: liberator.Mappings.flags.ARGUMENT | liberator.Mappings.flags.COUNT});

    liberator.mappings.add([liberator.modes.TEXTAREA, liberator.modes.VISUAL],
        ["t"], "Move before a character on the current line",
        function (count, arg)
        {
            var pos = liberator.editor.findCharForward(arg, count);
            if (pos >= 0)
                liberator.editor.moveToPosition(pos - 1, true, liberator.mode == liberator.modes.VISUAL);
        },
        { flags: liberator.Mappings.flags.ARGUMENT | liberator.Mappings.flags.COUNT});

    liberator.mappings.add([liberator.modes.TEXTAREA, liberator.modes.VISUAL],
        ["T"], "Move before a character on the current line, backwards",
        function (count, arg)
        {
            var pos = liberator.editor.findCharBackward(arg, count);
            if (pos >= 0)
                liberator.editor.moveToPosition(pos + 1, false, liberator.mode == liberator.modes.VISUAL);
        },
        { flags: liberator.Mappings.flags.ARGUMENT | liberator.Mappings.flags.COUNT});

    /////////////////////////////////////////////////////////////////////////////}}}
    ////////////////////// COMMANDS ////////////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////{{{
    
    addAbbreviationCommands("", "");
    addAbbreviationCommands("i", "insert");
    addAbbreviationCommands("c", "command line");

    /////////////////////////////////////////////////////////////////////////////}}}
    ////////////////////// PUBLIC SECTION //////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////{{{

    return {

        line: function ()
        {
            var line = 1;
            var text = editor().value;
            for (var i = 0; i < editor().selectionStart; i++)
                if (text[i] == "\n")
                    line++;
            return line;
        },

        col: function ()
        {
            var col = 1;
            var text = editor().value;
            for (var i = 0; i < editor().selectionStart; i++)
            {
                col++;
                if (text[i] == "\n")
                    col = 1;
            }
            return col;
        },

        unselectText: function ()
        {
            var elt = window.document.commandDispatcher.focusedElement;
            if (elt && elt.selectionEnd)
                elt.selectionEnd = elt.selectionStart;
        },

        selectedText: function ()
        {
            var text = editor().value;
            return text.substring(editor().selectionStart, editor().selectionEnd);
        },

        pasteClipboard: function ()
        {
            var elt = window.document.commandDispatcher.focusedElement;

            if (elt.setSelectionRange && liberator.util.readFromClipboard())
                // readFromClipboard would return 'undefined' if not checked
                // dunno about .setSelectionRange
            {
                var rangeStart = elt.selectionStart; // caret position
                var rangeEnd = elt.selectionEnd;
                var tempStr1 = elt.value.substring(0, rangeStart);
                var tempStr2 = liberator.util.readFromClipboard();
                var tempStr3 = elt.value.substring(rangeEnd);
                elt.value = tempStr1 + tempStr2  + tempStr3;
                elt.selectionStart = rangeStart + tempStr2.length;
                elt.selectionEnd = elt.selectionStart;
            }
        },

        // count is optional, defaults to 1
        executeCommand: function (cmd, count)
        {
            var controller = getController();
            if (!controller || !controller.supportsCommand(cmd) || !controller.isCommandEnabled(cmd))
            {
                liberator.beep();
                return false;
            }

            if (typeof count != "number" || count < 1)
                count = 1;

            var didCommand = false;
            while (count--)
            {
                // some commands need this try/catch workaround, because a cmd_charPrevious triggered
                // at the beginning of the textarea, would hang the doCommand()
                // good thing is, we need this code anyway for proper beeping
                try
                {
                    controller.doCommand(cmd);
                    didCommand = true;
                }
                catch (e)
                {
                    if (!didCommand)
                        liberator.beep();
                    return false;
                }
            }

            return true;
        },

        // cmd = y, d, c
        // motion = b, 0, gg, G, etc.
        executeCommandWithMotion: function (cmd, motion, count)
        {
            if (!typeof count == "number" || count < 1)
                count = 1;

            if (cmd == motion)
            {
                motion = "j";
                count--;
            }

            liberator.modes.set(liberator.modes.VISUAL, liberator.modes.TEXTAREA);

            switch (motion)
            {
                case "j":
                    this.executeCommand("cmd_beginLine", 1);
                    this.executeCommand("cmd_selectLineNext", count+1);
                    break;
                case "k":
                    this.executeCommand("cmd_beginLine", 1);
                    this.executeCommand("cmd_lineNext", 1);
                    this.executeCommand("cmd_selectLinePrevious", count+1);
                    break;
                case "h":
                    this.executeCommand("cmd_selectCharPrevious", count);
                    break;
                case "l":
                    this.executeCommand("cmd_selectCharNext", count);
                    break;
                case "e":
                case "w":
                    this.executeCommand("cmd_selectWordNext", count);
                    break;
                case "b":
                    this.executeCommand("cmd_selectWordPrevious", count);
                    break;
                case "0":
                case "^":
                    this.executeCommand("cmd_selectBeginLine", 1);
                    break;
                case "$":
                    this.executeCommand("cmd_selectEndLine", 1);
                    break;
                case "gg":
                    this.executeCommand("cmd_endLine", 1);
                    this.executeCommand("cmd_selectTop", 1);
                    this.executeCommand("cmd_selectBeginLine", 1);
                    break;
                case "G":
                    this.executeCommand("cmd_beginLine", 1);
                    this.executeCommand("cmd_selectBottom", 1);
                    this.executeCommand("cmd_selectEndLine", 1);
                    break;

                default:
                    liberator.beep();
                    return false;
            }

            switch (cmd)
            {
                case "d":
                    this.executeCommand("cmd_delete", 1);
                    // need to reset the mode as the visual selection changes it
                    liberator.modes.main = liberator.modes.TEXTAREA;
                    break;
                case "c":
                    this.executeCommand("cmd_delete", 1);
                    liberator.modes.set(liberator.modes.INSERT, liberator.modes.TEXTAREA);
                    break;
                case "y":
                    this.executeCommand("cmd_copy", 1);
                    this.unselectText();
                    break;

                default:
                    liberator.beep();
                    return false;
            }
            return true;
        },

        // This function will move/select up to given "pos"
        // Simple setSelectionRange() would be better, but we want to maintain the correct
        // order of selectionStart/End (a firefox bug always makes selectionStart <= selectionEnd)
        // Use only for small movements!
        moveToPosition: function (pos, forward, select)
        {
            if (!select)
            {
                editor().setSelectionRange(pos, pos);
                return;
            }

            if (forward)
            {
                if (pos <= editor().selectionEnd || pos > editor().value.length)
                    return false;

                do // TODO: test code for endless loops
                {
                    this.executeCommand("cmd_selectCharNext", 1);
                }
                while (editor().selectionEnd != pos);
            }
            else
            {
                if (pos >= editor().selectionStart || pos < 0)
                    return false;

                do // TODO: test code for endless loops
                {
                    this.executeCommand("cmd_selectCharPrevious", 1);
                }
                while (editor().selectionStart != pos);
            }
        },

        // returns the position of char
        findCharForward: function (ch, count)
        {
            if (!editor())
                return -1;

            lastFindChar = ch;
            lastFindCharFunc = this.findCharForward;

            var text = editor().value;
            if (!typeof count == "number" || count < 1)
                count = 1;

            for (var i = editor().selectionEnd + 1; i < text.length; i++)
            {
                if (text[i] == "\n")
                    break;
                if (text[i] == ch)
                    count--;
                if (count == 0)
                    return i + 1; // always position the cursor after the char
            }

            liberator.beep();
            return -1;
        },

        // returns the position of char
        findCharBackward: function (ch, count)
        {
            if (!editor())
                return -1;

            lastFindChar = ch;
            lastFindCharFunc = this.findCharBackward;

            var text = editor().value;
            if (!typeof count == "number" || count < 1)
                count = 1;

            for (var i = editor().selectionStart - 1; i >= 0; i--)
            {
                if (text[i] == "\n")
                    break;
                if (text[i] == ch)
                    count--;
                if (count == 0)
                    return i;
            }

            liberator.beep();
            return -1;
        },

        // TODO: clean up with 2 functions for textboxes and currentEditor?
        editWithExternalEditor: function ()
        {
            var textBox = null;
            if (!(liberator.config.isComposeWindow))
                textBox = document.commandDispatcher.focusedElement;

            var text = "";
            if (textBox)
                text = textBox.value;
            else if (typeof GetCurrentEditor == "function") // Thunderbird composer
                text = GetCurrentEditor().outputToString("text/plain", 2);
            else
                return false;

            var editor = liberator.options["editor"];
            var args = editor.split(" ");
            if (args.length < 1)
            {
                liberator.echoerr("no editor specified");
                return false;
            }

            try
            {
                var tmpfile = liberator.io.createTempFile();
            }
            catch (e)
            {
                liberator.echoerr("Could not create temporary file: " + e.message);
                return false;
            }
            try
            {
                liberator.io.writeFile(tmpfile, text);
            }
            catch (e)
            {
                liberator.echoerr("Could not write to temporary file " + tmpfile.path + ": " + e.message);
                return false;
            }

            var prog = args.shift();
            args.push(tmpfile.path)

            if (textBox)
            {
                textBox.setAttribute("readonly", "true");
                var oldBg = textBox.style.backgroundColor;
                var tmpBg = "yellow";
                textBox.style.backgroundColor = "#bbbbbb";
            }

            var newThread = Components.classes["@mozilla.org/thread-manager;1"].getService().newThread(0);
            // TODO: save return value in v:shell_error
            liberator.callFunctionInThread(newThread, liberator.io.run, [prog, args, true]);

            if (textBox)
                textBox.removeAttribute("readonly");


    //        if (v:shell_error != 0)
    //        {
    //            tmpBg = "red";
    //            liberator.echoerr("External editor returned with exit code " + retcode);
    //        }
    //        else
    //        {
                try
                {
                    var val = liberator.io.readFile(tmpfile);
                    if (textBox)
                        textBox.value = val;
                    else
                    {
                        //document.getElementById("content-frame").contentDocument.designMode = "on";
                        var editor = GetCurrentEditor();
                        var wholeDocRange = editor.document.createRange();
                        var rootNode = editor.rootElement.QueryInterface(Components.interfaces.nsIDOMNode);
                        wholeDocRange.selectNodeContents(rootNode);
                        editor.selection.addRange(wholeDocRange);
                        editor.selection.deleteFromDocument();
                        editor.insertText(val);
                        //setTimeout(function() {
                        //    document.getElementById("content-frame").contentDocument.designMode = "off";
                        //}, 100);
                    }
                }
                catch (e)
                {
                    tmpBg = "red";
                    liberator.echoerr("Could not read from temporary file " + tmpfile.path + ": " + e.message);
                }
    //        }

            // blink the textbox after returning - TODO: could use setInterval
            if (textBox)
            {
                var timeout = 100;
                textBox.style.backgroundColor = tmpBg;
                setTimeout(function () {
                    textBox.style.backgroundColor = oldBg;
                    setTimeout(function () {
                        textBox.style.backgroundColor = tmpBg;
                        setTimeout(function () {
                            textBox.style.backgroundColor = oldBg;
                        }, timeout);
                    }, timeout);
                }, timeout);
            }

            tmpfile.remove(false);
            return true;
        },

        // Abbreviations {{{

        abbreviations: {
            __iterator__: function ()
            {
                var tmpCmd;
                for (var lhs in abbrev)
                {
                    for (var i = 0; i < abbrev[lhs].length; i++)
                    {
                        tmpCmd = (abbrev[lhs][i][0] == "!") ? "abbreviate" : abbrev[lhs][i][0] + "abbrev";
                        yield (tmpCmd + " " + lhs + " " + abbrev[lhs][i][1] + "\n");
                    }
                }
            }
        },

        // filter is i, c or "!" (insert or command abbreviations or both)
        listAbbreviations: function (filter, lhs)
        {
            if (lhs) // list only that one
            {
                if (abbrev[lhs])
                {
                    for (var i = 0; i < abbrev[lhs].length; i++)
                    {
                        if (abbrev[lhs][i][0] == filter)
                            liberator.echo(abbrev[lhs][i][0] + "    " + lhs + "        " + abbrev[lhs][i][1]);
                        return true;
                    }
                }
                liberator.echoerr("No abbreviations found");
                return false;
            }
            else // list all (for that filter {i,c,!})
            {
                var flagFound = false;
                var searchFilter = (filter == "!") ? "!ci" : filter + "!"; // ! -> list all, on c or i ! matches too)
                var list = "<table>";
                for (var tmplhs in abbrev)
                {
                    for (var i = 0; i < abbrev[tmplhs].length; i++)
                    {
                        if (searchFilter.indexOf(abbrev[tmplhs][i][0]) > -1)
                        {
                            if (!flagFound)
                                flagFound = true;

                            list += "<tr>";
                            list += "<td> " + abbrev[tmplhs][i][0] + "</td>";
                            list += "<td> " + liberator.util.escapeHTML(tmplhs) + "</td>";
                            list += "<td> " + liberator.util.escapeHTML(abbrev[tmplhs][i][1]) + "</td>";
                            list += "</tr>";
                        }
                    }
                }

                if (!flagFound)
                {
                    liberator.echoerr("No abbreviations found");
                    return;
                }
                list += "</table>";
                liberator.commandline.echo(list, liberator.commandline.HL_NORMAL, liberator.commandline.FORCE_MULTILINE);
            }
        },

        // System for adding abbreviations:
        //
        // filter == ! delete all, and set first (END)
        //
        // if filter == ! remove all and add it as only END
        //
        // variant 1: rhs matches anywere in loop
        //
        //          1 mod matches anywhere in loop
        //                  a) simple replace and
        //                      I)  (maybe there's another rhs that matches?  not possible)
        //                          (when there's another item, it's opposite mod with different rhs)
        //                          (so do nothing further but END)
        //
        //          2 mod does not match
        //                  a) the opposite is there -> make a ! and put it as only and END
        //                 (b) a ! is there. do nothing END)
        //
        // variant 2: rhs matches *no*were in loop and filter is c or i
        //            everykind of current combo is possible to 1 {c,i,!} or two {c and i}
        //
        //          1 mod is ! split into two i + c END
        //          1 not !: opposite mode (first), add/change 'second' and END
        //          1 not !: same mode (first), overwrite first this END
        //
        addAbbreviation: function (filter, lhs, rhs)
        {
            if (!abbrev[lhs])
            {
                abbrev[lhs] = [];
                abbrev[lhs][0] = [filter, rhs];
                return;
            }

            if (filter == "!")
            {
                if (abbrev[lhs][1])
                    abbrev[lhs][1] = "";
                abbrev[lhs][0] = [filter, rhs];
                return;
            }

            for (var i = 0; i < abbrev[lhs].length; i++)
            {
                if (abbrev[lhs][i][1] == rhs)
                {
                    if (abbrev[lhs][i][0] == filter)
                    {
                        abbrev[lhs][i] = [filter, rhs];
                        return;
                    }
                    else
                    {
                        if (abbrev[lhs][i][0] != "!")
                        {
                            if (abbrev[lhs][1])
                                abbrev[lhs][1] = "";
                            abbrev[lhs][0] = ["!", rhs];
                            return;
                        }
                        else
                        {
                            return;
                        }
                    }
                }
            }

            if (abbrev[lhs][0][0] == "!")
            {
                var tmpOpp = ("i" == filter) ? "c" : "i";
                abbrev[lhs][1] = [tmpOpp, abbrev[lhs][0][1]];
                abbrev[lhs][0] = [filter, rhs];
                return;
            }

            if (abbrev[lhs][0][0] != filter)
                abbrev[lhs][1] = [filter, rhs];
            else
                abbrev[lhs][0] = [filter, rhs];
        },

        removeAbbreviation: function (filter, lhs)
        {
            if (!lhs)
            {
                liberator.echoerr("E474: Invalid argument");
                return false;
            }

            if (abbrev[lhs]) // abbrev exists
            {
                if (filter == "!")
                {
                    abbrev[lhs] = "";
                    return true;
                }
                else
                {
                    if (!abbrev[lhs][1]) // only one exists
                    {
                        if (abbrev[lhs][0][0] == "!") // exists as ! -> no 'full' delete
                        {
                            abbrev[lhs][0][0] = (filter == "i") ? "c" : "i";   // ! - i = c; ! - c = i
                            return true;
                        }
                        else if (abbrev[lhs][0][0] == filter)
                        {
                            abbrev[lhs] = "";
                            return true;
                        }
                    }
                    else // two abbrev's exists ( 'i' or  'c' (filter as well))
                    {
                        if (abbrev[lhs][0][0] == "c" && filter == "c")
                            abbrev[lhs][0] = abbrev[lhs][1];

                        abbrev[lhs][1] = "";

                        return true;
                    }
                }
            }

            liberator.echoerr("E24: No such abbreviation");
            return false;
        },

        removeAllAbbreviations: function (filter)
        {
            if (filter == "!")
            {
                abbrev = {};
            }
            else
            {
                for (var lhs in abbrev)
                {
                    for (var i = 0; i < abbrev[lhs].length; i++)
                    {
                        if (abbrev[lhs][i][0] == "!" || abbrev[lhs][i][0] == filter)
                            this.removeAbbreviation(filter, lhs);
                    }
                }
            }
        },

        expandAbbreviation: function (filter) // try to find an candidate and replace accordingly
        {
            var textbox   = editor();
            var text      = textbox.value;
            var currStart = textbox.selectionStart;
            var currEnd   = textbox.selectionEnd;
            var foundWord = text.substring(0, currStart).replace(/^(.|\n)*?(\S+)$/m, "$2"); // get last word \b word boundary
            if (!foundWord)
                return true;

            for (var lhs in abbrev)
            {
                for (var i = 0; i < abbrev[lhs].length; i++)
                {
                    if (lhs == foundWord && (abbrev[lhs][i][0] == filter || abbrev[lhs][i][0] == "!"))
                    {
                        // if found, replace accordingly
                        var len = foundWord.length;
                        var abbrText = abbrev[lhs][i][1];
                        text = text.substring(0, currStart - len) + abbrText + text.substring(currStart);
                        textbox.value = text;
                        textbox.selectionStart = currStart - len + abbrText.length;
                        textbox.selectionEnd   = currEnd   - len + abbrText.length;
                        break;
                    }
                }
            }
            return true;
        }
        //}}}
    };
    //}}}
}; //}}}

// vim: set fdm=marker sw=4 ts=4 et:
