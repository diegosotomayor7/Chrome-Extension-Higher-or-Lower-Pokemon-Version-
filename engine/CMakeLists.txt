cmake_minimum_required(VERSION 3.20)
project(pkmn_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# --- Core engine (plain C++, no platform dependencies) ---

add_library(pkmn_engine_core STATIC src/engine.cpp)
target_include_directories(pkmn_engine_core PUBLIC include)

if(MSVC)
    target_compile_options(pkmn_engine_core PUBLIC /W4 /permissive- /utf-8)
else()
    target_compile_options(pkmn_engine_core PUBLIC -Wall -Wextra -Wpedantic)
endif()

if(EMSCRIPTEN)
    # --- WebAssembly module for the extension: wasm/pkmn-engine.{js,wasm} ---

    target_compile_options(pkmn_engine_core PUBLIC -fexceptions)

    add_executable(pkmn_engine src/bindings.cpp)
    target_link_libraries(pkmn_engine PRIVATE pkmn_engine_core)
    target_link_options(pkmn_engine PRIVATE
        -lembind
        -fexceptions
        -sMODULARIZE=1
        -sEXPORT_NAME=createPkmnEngine
        -sENVIRONMENT=web
        # Extension pages forbid eval/new Function, which embind otherwise uses to generate glue code.
        -sDYNAMIC_EXECUTION=0
        -sFILESYSTEM=0
    )
    set_target_properties(pkmn_engine PROPERTIES
        OUTPUT_NAME pkmn-engine
        SUFFIX .js
        RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../wasm
    )
else()
    # --- Native unit tests (GoogleTest) ---

    include(FetchContent)
    FetchContent_Declare(googletest
        URL https://github.com/google/googletest/archive/refs/tags/v1.15.2.zip
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    )
    set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)  # match MSVC's default runtime
    set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)
    FetchContent_MakeAvailable(googletest)

    enable_testing()
    add_executable(engine_tests tests/engine_tests.cpp)
    target_link_libraries(engine_tests PRIVATE pkmn_engine_core GTest::gtest_main)

    include(GoogleTest)
    gtest_discover_tests(engine_tests)
endif()
