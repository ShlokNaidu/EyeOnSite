import subprocess
import os
import sys

def run_command(command, cwd):
    print(f"Running '{command}' in {cwd}...")
    try:
        # Use shell=True for Windows compatibility with npm
        subprocess.run(command, cwd=cwd, shell=True, check=True)
        print(f"✅ Successfully completed in {cwd}\n")
    except subprocess.CalledProcessError as e:
        print(f"❌ Error running command in {cwd}: {e}")
        sys.exit(1)

def main():
    root_dir = os.path.abspath(os.path.dirname(__file__))
    
    # 1. Install Backend Dependencies
    backend_dir = os.path.join(root_dir, 'backend')
    if os.path.exists(backend_dir):
        run_command('npm install', backend_dir)
        
    # 2. Install Frontend Dependencies
    frontend_dir = os.path.join(root_dir, 'frontend')
    if os.path.exists(frontend_dir):
        run_command('npm install', frontend_dir)
        
    # 3. Install AI Service Dependencies
    ai_dir = os.path.join(root_dir, 'ai_service')
    if os.path.exists(ai_dir):
        run_command(f'pip install -r {os.path.join(root_dir, "requirements.txt")}', ai_dir)

    print("🎉 All prerequisites have been successfully downloaded!")

if __name__ == "__main__":
    main()
