///usr/bin/env jbang "$0" "$@" ; exit $?
//DEPS info.picocli:picocli:4.7.5

import picocli.CommandLine;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;

@Command(name = "install", mixinStandardHelpOptions = true, version = "1.0",
        description = "Installs the NoteZen Agentic SDLC Framework skills and templates.")
public class install implements Callable<Integer> {

    @Option(names = {"-g", "--global"}, description = "Install globally to ~/.gemini/config/skills")
    private boolean global;

    @Option(names = {"-l", "--local"}, description = "Install locally to a target project directory")
    private String localTarget;

    public static void main(String... args) {
        int exitCode = new CommandLine(new install()).execute(args);
        System.exit(exitCode);
    }

    @Override
    public Integer call() throws Exception {
        if (!global && localTarget == null) {
            System.err.println("Error: You must specify either --global or --local <target-dir>");
            return 1;
        }

        System.out.println("🚀 Initializing NoteZen Installer Workflow...");

        WorkflowEngine engine = new WorkflowEngine();
        
        String sourceSkills = ".agent/skills";
        String sourceTemplates = "docs/templates";

        if (global) {
            String home = System.getProperty("user.home");
            Path targetSkills = Paths.get(home, ".gemini", "config", "skills");
            engine.addTask(new CopyTask("Install Global Skills", Paths.get(sourceSkills), targetSkills));
            System.out.println("Note: Global installation skips docs/templates.");
        } else {
            Path targetPath = Paths.get(localTarget);
            Path targetSkills = targetPath.resolve(".agent").resolve("skills");
            Path targetDocs = targetPath.resolve("docs").resolve("templates");
            
            engine.addTask(new CopyTask("Install Local Skills", Paths.get(sourceSkills), targetSkills));
            engine.addTask(new CopyTask("Install Local Templates", Paths.get(sourceTemplates), targetDocs));
        }

        boolean success = engine.execute();
        
        if (success) {
            System.out.println("✅ Installation complete!");
            return 0;
        } else {
            System.err.println("❌ Installation failed.");
            return 1;
        }
    }

    // --- Quarkus-Flow Inspired Deterministic Engine ---

    static class WorkflowEngine {
        private final List<WorkflowTask> tasks = new ArrayList<>();

        public void addTask(WorkflowTask task) {
            tasks.add(task);
        }

        public boolean execute() {
            for (int i = 0; i < tasks.size(); i++) {
                WorkflowTask task = tasks.get(i);
                System.out.printf("[%d/%d] Executing: %s... ", i + 1, tasks.size(), task.getName());
                try {
                    task.execute();
                    System.out.println("DONE");
                } catch (Exception e) {
                    System.out.println("FAILED");
                    e.printStackTrace();
                    return false;
                }
            }
            return true;
        }
    }

    interface WorkflowTask {
        String getName();
        void execute() throws Exception;
    }

    static class CopyTask implements WorkflowTask {
        private final String name;
        private final Path source;
        private final Path target;

        public CopyTask(String name, Path source, Path target) {
            this.name = name;
            this.source = source;
            this.target = target;
        }

        @Override
        public String getName() {
            return name + " (" + source + " -> " + target + ")";
        }

        @Override
        public void execute() throws Exception {
            if (!Files.exists(source)) {
                throw new NoSuchFileException("Source directory does not exist: " + source.toAbsolutePath());
            }

            Files.walkFileTree(source, new SimpleFileVisitor<Path>() {
                @Override
                public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                    Path targetDir = target.resolve(source.relativize(dir));
                    if (!Files.exists(targetDir)) {
                        Files.createDirectories(targetDir);
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                    Files.copy(file, target.resolve(source.relativize(file)), StandardCopyOption.REPLACE_EXISTING);
                    return FileVisitResult.CONTINUE;
                }
            });
        }
    }
}
