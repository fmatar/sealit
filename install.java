///usr/bin/env jbang "$0" "$@" ; exit $?
//DEPS info.picocli:picocli:4.7.5

import picocli.CommandLine;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.PosixFilePermission;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;

@Command(name = "install", mixinStandardHelpOptions = true, version = "3.0",
        description = "Installs the Agentic SDLC Framework skills, engine, and templates.")
public class install implements Callable<Integer> {

    @Option(names = {"-g", "--global"}, description = "Install globally to ~/.gemini/config/skills")
    private boolean global;

    @Option(names = {"-l", "--local"}, description = "Install locally to a target project directory")
    private String localTarget;

    @Option(names = {"--skip-detect"}, description = "Skip automatic stack detection after installation")
    private boolean skipDetect;

    @Option(names = {"--skills-cli"}, description = "Delegate skill installation to Vercel Labs skills CLI (npx skills add)")
    private boolean useSkillsCli;

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

        System.out.println("🚀 Initializing Agentic SDLC Framework Installer...");

        if (useSkillsCli) {
            System.out.println("📦 Invoking Vercel Labs Skills CLI (npx skills add)...");
            List<String> cmd = new ArrayList<>();
            cmd.add("npx");
            cmd.add("--yes");
            cmd.add("skills");
            cmd.add("add");
            cmd.add("fmatar/agentic-sdlc-framework");
            cmd.add("--skill");
            cmd.add("*");
            cmd.add("-y");
            cmd.add("--copy");
            if (global) {
                cmd.add("--global");
            }
            try {
                ProcessBuilder pb = new ProcessBuilder(cmd);
                if (!global && localTarget != null) {
                    pb.directory(Paths.get(localTarget).toAbsolutePath().toFile());
                }
                pb.inheritIO();
                Process p = pb.start();
                int exitCode = p.waitFor();
                if (exitCode == 0) {
                    System.out.println("✅ Skills successfully installed via Vercel Labs skills CLI!");
                } else {
                    System.err.println("⚠️ Skills CLI returned code: " + exitCode + ", falling back to direct copy...");
                }
            } catch (Exception e) {
                System.err.println("⚠️ Could not execute skills CLI (" + e.getMessage() + "), falling back to direct copy...");
            }
        }

        WorkflowEngine engine = new WorkflowEngine();
        
        String sourceSkills = ".agent/skills";
        String sourceScripts = ".agent/scripts";
        String sourceTemplates = "docs/templates";

        Path targetPath = null;
        String agentDir = ".agent";

        if (global) {
            String home = System.getProperty("user.home");
            Path targetSkills = Paths.get(home, ".gemini", "config", "skills");
            Path targetScripts = Paths.get(home, ".gemini", "config", "scripts");
            engine.addTask(new CopyTask("Install Global Skills", Paths.get(sourceSkills), targetSkills));
            if (Files.exists(Paths.get(sourceScripts))) {
                engine.addTask(new CopyTask("Install Global Engine Scripts", Paths.get(sourceScripts), targetScripts));
            }
            System.out.println("Note: Global installation skips docs/templates.");
        } else {
            targetPath = Paths.get(localTarget).toAbsolutePath().normalize();
            if (Files.exists(targetPath.resolve(".agents").resolve("skills"))) {
                agentDir = ".agents";
            }
            Path targetSkills = targetPath.resolve(agentDir).resolve("skills");
            Path targetScripts = targetPath.resolve(agentDir).resolve("scripts");
            Path targetDocs = targetPath.resolve("docs").resolve("templates");
            
            engine.addTask(new CopyTask("Install Local Skills", Paths.get(sourceSkills), targetSkills));
            if (Files.exists(Paths.get(sourceScripts))) {
                engine.addTask(new CopyTask("Install Local Engine Scripts", Paths.get(sourceScripts), targetScripts));
            }
            if (Files.exists(Paths.get(sourceTemplates))) {
                engine.addTask(new CopyTask("Install Local Templates", Paths.get(sourceTemplates), targetDocs));
            }
        }

        boolean success = engine.execute();
        
        if (success) {
            System.out.println("✅ Installation complete!");
            
            if (!global && !skipDetect && targetPath != null) {
                Path engineScript = targetPath.resolve(agentDir).resolve("scripts").resolve("sdlc-engine.mjs");
                if (Files.exists(engineScript)) {
                    try {
                        System.out.println("\n🔍 Running Universal Stack Detection...");
                        Process process = new ProcessBuilder("node", agentDir + "/scripts/sdlc-engine.mjs", "detect")
                                .directory(targetPath.toFile())
                                .inheritIO()
                                .start();
                        process.waitFor();
                    } catch (Exception e) {
                        System.out.println("⚠️ Automatic stack detection skipped: " + e.getMessage());
                    }
                }
            }
            
            return 0;
        } else {
            System.err.println("❌ Installation failed.");
            return 1;
        }
    }

    // --- Deterministic Engine ---

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
                    Path destFile = target.resolve(source.relativize(file));
                    Files.copy(file, destFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES);
                    if (destFile.toString().endsWith(".sh") || destFile.toString().endsWith(".mjs")) {
                        try {
                            Set<PosixFilePermission> perms = Files.getPosixFilePermissions(destFile);
                            perms.add(PosixFilePermission.OWNER_EXECUTE);
                            perms.add(PosixFilePermission.GROUP_EXECUTE);
                            perms.add(PosixFilePermission.OTHERS_EXECUTE);
                            Files.setPosixFilePermissions(destFile, perms);
                        } catch (UnsupportedOperationException ignored) {
                            // Non-posix filesystem
                        }
                    }
                    return FileVisitResult.CONTINUE;
                }
            });
        }
    }
}
